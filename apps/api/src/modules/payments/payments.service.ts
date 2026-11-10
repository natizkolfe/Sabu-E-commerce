import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

@Injectable()
export class PaymentsService {
  readonly schema = 'payments' as const;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async listActiveMethods() {
    const { rows } = await this.db.query<{
      id: string;
      code: string;
      display_name: string;
      channel: string;
      provider_code: string;
    }>(
      `SELECT m.id, m.code, m.display_name, m.channel, p.code AS provider_code
       FROM payments.payment_methods m
       JOIN payments.payment_providers p ON p.id = m.provider_id
       WHERE m.is_active AND p.integration_status IN ('sandbox','live')
       ORDER BY m.sort_order`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      displayName: r.display_name,
      channel: r.channel,
      provider: r.provider_code,
    }));
  }

  async getTelebirrSettings() {
    const { rows } = await this.db.query<{
      display_name: string;
      merchant_account: string;
      instructions: string;
      help_text: string | null;
      txn_format_regex: string;
      is_active: boolean;
    }>(
      `SELECT display_name, merchant_account, instructions, help_text,
              txn_format_regex, is_active
       FROM payments.telebirr_merchant_settings WHERE id = 1`,
    );
    const r = rows[0];
    return {
      displayName: r?.display_name ?? 'Sabu Online Shopping',
      merchantAccount:
        r?.merchant_account ?? 'Configure Telebirr merchant account',
      instructions:
        r?.instructions ??
        'Send the exact Total Payable via Telebirr, then enter the transaction reference.',
      helpText: r?.help_text ?? null,
      txnFormatRegex: r?.txn_format_regex ?? '^[A-Za-z0-9\\-]{6,40}$',
      isActive: r?.is_active ?? true,
    };
  }

  async updateTelebirrSettings(
    user: AuthUser,
    input: {
      displayName?: string;
      merchantAccount?: string;
      instructions?: string;
      helpText?: string | null;
      txnFormatRegex?: string;
      isActive?: boolean;
    },
  ) {
    await this.db.query(
      `UPDATE payments.telebirr_merchant_settings SET
         display_name = COALESCE($1, display_name),
         merchant_account = COALESCE($2, merchant_account),
         instructions = COALESCE($3, instructions),
         help_text = CASE WHEN $4::boolean THEN $5 ELSE help_text END,
         txn_format_regex = COALESCE($6, txn_format_regex),
         is_active = COALESCE($7, is_active),
         updated_by = $8,
         updated_at = now()
       WHERE id = 1`,
      [
        input.displayName ?? null,
        input.merchantAccount ?? null,
        input.instructions ?? null,
        input.helpText !== undefined,
        input.helpText ?? null,
        input.txnFormatRegex ?? null,
        input.isActive ?? null,
        user.id,
      ],
    );
    return this.getTelebirrSettings();
  }

  validateTelebirrTxnId(txnId: string, regex: string) {
    const trimmed = txnId.trim();
    if (!trimmed) return false;
    try {
      return new RegExp(regex).test(trimmed);
    } catch {
      return /^[A-Za-z0-9-]{6,40}$/.test(trimmed);
    }
  }

  async listBankAccounts() {
    const { rows } = await this.db.query<{
      id: string;
      bank_name: string;
      account_name: string;
      account_number_masked: string;
      currency: string;
      branch_name: string | null;
      instructions: string | null;
    }>(
      `SELECT id, bank_name, account_name, account_number_masked, currency, branch_name, instructions
       FROM payments.company_bank_accounts
       WHERE is_active
       ORDER BY sort_order`,
    );
    return rows.map((r) => ({
      id: r.id,
      bankName: r.bank_name,
      accountName: r.account_name,
      accountNumberMasked: r.account_number_masked,
      currency: r.currency,
      branchName: r.branch_name,
      instructions: r.instructions,
    }));
  }

  async initializeChapa(input: {
    paymentIntentId: string;
    returnUrl: string;
    customerEmail?: string;
    customerName?: string;
    customerPhone?: string;
  }) {
    const { rows: intents } = await this.db.query<{
      id: string;
      order_id: string;
      amount: string;
      currency: string;
      status: string;
      order_number: string;
    }>(
      `SELECT pi.id, pi.order_id, pi.amount::text, pi.currency, pi.status, o.order_number
       FROM payments.payment_intents pi
       JOIN sales.orders o ON o.id = pi.order_id
       WHERE pi.id = $1`,
      [input.paymentIntentId],
    );
    const intent = intents[0];
    if (!intent) throw new NotFoundException('Payment intent not found');
    if (intent.status === 'succeeded') {
      throw new BadRequestException('Payment already succeeded');
    }

    const { rows: methods } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments.payment_methods WHERE code = 'chapa_checkout' AND is_active`,
    );
    if (!methods[0]) throw new BadRequestException('Chapa is not enabled');

    const merchantRef = `CHAPA-${intent.order_number}-${randomBytes(4).toString('hex')}`;
    const idempotencyKey = randomBytes(16).toString('hex');

    const { rows: txs } = await this.db.query<{ id: string }>(
      `INSERT INTO payments.payment_transactions (
         payment_intent_id, payment_method_id, merchant_reference, idempotency_key,
         amount, currency, status
       ) VALUES ($1,$2,$3,$4,$5,$6,'initiated')
       RETURNING id`,
      [
        intent.id,
        methods[0].id,
        merchantRef,
        idempotencyKey,
        intent.amount,
        intent.currency,
      ],
    );

    const secret = this.config.get<string>('CHAPA_SECRET_KEY');
    const base =
      this.config.get<string>('CHAPA_BASE_URL') ?? 'https://api.chapa.co/v1';

    // Sandbox / offline mode: no secret → return mock checkout URL
    if (!secret) {
      this.logger.warn('CHAPA_SECRET_KEY missing — returning mock checkout URL');
      const checkoutUrl = `${input.returnUrl}?tx_ref=${encodeURIComponent(merchantRef)}&status=mock`;
      await this.db.query(
        `UPDATE payments.payment_transactions SET status = 'pending', updated_at = now() WHERE id = $1`,
        [txs[0].id],
      );
      await this.db.query(
        `UPDATE payments.payment_intents SET status = 'processing', updated_at = now() WHERE id = $1`,
        [intent.id],
      );
      return {
        transactionId: txs[0].id,
        merchantReference: merchantRef,
        checkoutUrl,
        mode: 'mock' as const,
      };
    }

    const res = await fetch(`${base}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: intent.amount,
        currency: intent.currency,
        email: input.customerEmail ?? 'guest@sabu.local',
        first_name: input.customerName?.split(' ')[0] ?? 'Customer',
        last_name: input.customerName?.split(' ').slice(1).join(' ') || 'Sabu',
        phone_number: input.customerPhone,
        tx_ref: merchantRef,
        callback_url: this.config.get('CHAPA_WEBHOOK_URL'),
        return_url: input.returnUrl,
      }),
    });
    const body = (await res.json()) as {
      status?: string;
      message?: string;
      data?: { checkout_url?: string };
    };
    if (!res.ok || !body.data?.checkout_url) {
      await this.db.query(
        `UPDATE payments.payment_transactions
         SET status = 'failed', failure_message = $2, updated_at = now()
         WHERE id = $1`,
        [txs[0].id, body.message ?? 'Chapa initialize failed'],
      );
      throw new BadRequestException(body.message ?? 'Chapa initialize failed');
    }

    await this.db.query(
      `UPDATE payments.payment_transactions SET status = 'pending', updated_at = now() WHERE id = $1`,
      [txs[0].id],
    );
    await this.db.query(
      `UPDATE payments.payment_intents SET status = 'processing', updated_at = now() WHERE id = $1`,
      [intent.id],
    );

    return {
      transactionId: txs[0].id,
      merchantReference: merchantRef,
      checkoutUrl: body.data.checkout_url,
      mode: 'live' as const,
    };
  }

  async handleChapaWebhook(rawBody: unknown, signature?: string) {
    const { rows: providers } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments.payment_providers WHERE code = 'chapa'`,
    );
    if (!providers[0]) throw new NotFoundException('Chapa provider missing');

    const secret = this.config.get<string>('CHAPA_WEBHOOK_SECRET') ?? '';
    let signatureValid = !secret;
    if (secret && signature) {
      const expected = createHmac('sha256', secret)
        .update(JSON.stringify(rawBody))
        .digest('hex');
      try {
        signatureValid = timingSafeEqual(
          Buffer.from(expected),
          Buffer.from(signature),
        );
      } catch {
        signatureValid = false;
      }
    }

    const payload = rawBody as {
      tx_ref?: string;
      reference?: string;
      status?: string;
      event?: string;
    };
    const eventId =
      payload.reference ??
      payload.tx_ref ??
      createHash('sha256').update(JSON.stringify(rawBody)).digest('hex');

    await this.db.query(
      `INSERT INTO payments.webhook_events (
         provider_id, provider_event_id, signature_valid, payload, processing_status
       ) VALUES ($1,$2,$3,$4::jsonb,'received')
       ON CONFLICT (provider_id, provider_event_id) DO NOTHING`,
      [providers[0].id, eventId, signatureValid, JSON.stringify(rawBody)],
    );

    if (!signatureValid && secret) {
      return { ok: false, reason: 'invalid_signature' };
    }

    const txRef = payload.tx_ref;
    if (!txRef) return { ok: true, ignored: true };

    // Verify with Chapa when secret present; mock auto-succeed
    const chapaSecret = this.config.get<string>('CHAPA_SECRET_KEY');
    let verified = !chapaSecret;
    if (chapaSecret) {
      const base =
        this.config.get<string>('CHAPA_BASE_URL') ?? 'https://api.chapa.co/v1';
      const verifyRes = await fetch(`${base}/transaction/verify/${txRef}`, {
        headers: { Authorization: `Bearer ${chapaSecret}` },
      });
      const verifyBody = (await verifyRes.json()) as {
        status?: string;
        data?: { status?: string; reference?: string };
      };
      verified =
        verifyRes.ok &&
        (verifyBody.data?.status === 'success' ||
          verifyBody.status === 'success');
      if (verified && verifyBody.data?.reference) {
        await this.db.query(
          `UPDATE payments.payment_transactions
           SET provider_reference = $2 WHERE merchant_reference = $1`,
          [txRef, verifyBody.data.reference],
        );
      }
    }

    if (!verified && payload.status !== 'success') {
      return { ok: true, verified: false };
    }

    await this.markTransactionSucceeded(txRef, 'webhook');
    return { ok: true, verified: true };
  }

  /** Dev helper: complete a mock Chapa payment by tx_ref */
  async completeMockChapa(txRef: string) {
    if (this.config.get('CHAPA_SECRET_KEY')) {
      throw new BadRequestException('Mock complete disabled when Chapa is configured');
    }
    await this.markTransactionSucceeded(txRef, 'verify_api');
    return { ok: true };
  }

  async submitBankTransfer(input: {
    paymentIntentId: string;
    companyBankAccountId: string;
    customerReference?: string;
    receiptStorageKey: string;
  }) {
    const { rows: intents } = await this.db.query<{
      id: string;
      amount: string;
      currency: string;
      status: string;
    }>(
      `SELECT id, amount::text, currency, status FROM payments.payment_intents WHERE id = $1`,
      [input.paymentIntentId],
    );
    if (!intents[0]) throw new NotFoundException('Payment intent not found');

    const { rows: methods } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments.payment_methods WHERE code = 'bank_transfer_manual' AND is_active`,
    );
    if (!methods[0]) throw new BadRequestException('Bank transfer not enabled');

    const { rows: banks } = await this.db.query<{ id: string }>(
      `SELECT id FROM payments.company_bank_accounts WHERE id = $1 AND is_active`,
      [input.companyBankAccountId],
    );
    if (!banks[0]) throw new BadRequestException('Invalid bank account');

    const merchantRef = `BANK-${input.paymentIntentId.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
    const { rows: txs } = await this.db.query<{ id: string }>(
      `INSERT INTO payments.payment_transactions (
         payment_intent_id, payment_method_id, merchant_reference, idempotency_key,
         amount, currency, status, manual_proof_key, company_bank_account_id, customer_reference
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9)
       RETURNING id`,
      [
        intents[0].id,
        methods[0].id,
        merchantRef,
        randomBytes(16).toString('hex'),
        intents[0].amount,
        intents[0].currency,
        input.receiptStorageKey,
        input.companyBankAccountId,
        input.customerReference ?? null,
      ],
    );

    await this.db.query(
      `UPDATE payments.payment_intents SET status = 'processing', updated_at = now() WHERE id = $1`,
      [intents[0].id],
    );

    await this.db.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('payment', $1, 'payment.bank_transfer_submitted', $2::jsonb)`,
      [
        txs[0].id,
        JSON.stringify({ transactionId: txs[0].id, intentId: intents[0].id }),
      ],
    );

    return {
      transactionId: txs[0].id,
      status: 'pending_verification',
      message: 'Receipt submitted. An administrator will verify the deposit.',
    };
  }

  async listPendingVerifications() {
    const { rows } = await this.db.query<{
      id: string;
      merchant_reference: string;
      amount: string;
      currency: string;
      customer_reference: string | null;
      provider_reference: string | null;
      manual_proof_key: string | null;
      order_number: string;
      order_id: string;
      bank_name: string | null;
      method_code: string;
      method_name: string;
      recipient_name: string | null;
      recipient_phone: string | null;
      subtotal: string;
      delivery_fee: string;
      grand_total: string;
      initiated_at: Date;
      duplicate_count: string;
    }>(
      `SELECT t.id, t.merchant_reference, t.amount::text, t.currency, t.customer_reference,
              t.provider_reference, t.manual_proof_key, o.order_number, o.id AS order_id,
              b.bank_name, m.code AS method_code, m.display_name AS method_name,
              o.ship_recipient_name AS recipient_name, o.ship_recipient_phone AS recipient_phone,
              o.subtotal::text, o.delivery_fee::text, o.grand_total::text,
              t.initiated_at,
              (
                SELECT count(*)::text FROM payments.payment_transactions t2
                WHERE t2.provider_reference IS NOT NULL
                  AND t.provider_reference IS NOT NULL
                  AND lower(t2.provider_reference) = lower(t.provider_reference)
                  AND t2.id <> t.id
              ) AS duplicate_count
       FROM payments.payment_transactions t
       JOIN payments.payment_intents i ON i.id = t.payment_intent_id
       JOIN sales.orders o ON o.id = i.order_id
       JOIN payments.payment_methods m ON m.id = t.payment_method_id
       LEFT JOIN payments.company_bank_accounts b ON b.id = t.company_bank_account_id
       WHERE m.code IN ('bank_transfer_manual', 'telebirr_manual') AND t.status = 'pending'
       ORDER BY t.initiated_at`,
    );

    const items = [];
    for (const r of rows) {
      const { rows: itemRows } = await this.db.query<{
        name_snapshot: string;
        quantity: string;
        line_total: string;
      }>(
        `SELECT name_snapshot, quantity::text, line_total::text
         FROM sales.order_items WHERE order_id = $1 ORDER BY line_no`,
        [r.order_id],
      );
      items.push({
        transactionId: r.id,
        methodCode: r.method_code,
        methodName: r.method_name,
        merchantReference: r.merchant_reference,
        amount: Number(r.amount),
        currency: r.currency,
        customerReference: r.customer_reference,
        providerReference: r.provider_reference,
        telebirrTxnId: r.method_code === 'telebirr_manual' ? r.provider_reference : null,
        receiptKey: r.manual_proof_key,
        orderNumber: r.order_number,
        orderId: r.order_id,
        bankName: r.bank_name,
        customerName: r.recipient_name,
        phone: r.recipient_phone,
        subtotal: Number(r.subtotal),
        deliveryFee: Number(r.delivery_fee),
        grandTotal: Number(r.grand_total),
        duplicateFlag: Number(r.duplicate_count) > 0,
        items: itemRows.map((it) => ({
          name: it.name_snapshot,
          quantity: Number(it.quantity),
          lineTotal: Number(it.line_total),
        })),
        submittedAt: r.initiated_at,
      });
    }
    return items;
  }

  async approveBankTransfer(user: AuthUser, transactionId: string) {
    return this.verifyManualPayment(user, transactionId, 'verified');
  }

  async verifyManualPayment(
    user: AuthUser,
    transactionId: string,
    action: 'verified' | 'flagged_duplicate' = 'verified',
    notes?: string,
  ) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        payment_intent_id: string;
        status: string;
        merchant_reference: string;
        order_id: string;
      }>(
        `SELECT t.id, t.payment_intent_id, t.status, t.merchant_reference, i.order_id
         FROM payments.payment_transactions t
         JOIN payments.payment_intents i ON i.id = t.payment_intent_id
         WHERE t.id = $1 FOR UPDATE OF t`,
        [transactionId],
      );
      const tx = rows[0];
      if (!tx) throw new NotFoundException('Transaction not found');
      if (tx.status !== 'pending') {
        throw new BadRequestException(`Cannot approve status=${tx.status}`);
      }

      await client.query(
        `UPDATE payments.payment_transactions
         SET status = 'succeeded', verified_by = $2, verified_at = now(),
             completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [tx.id, user.id],
      );
      await client.query(
        `INSERT INTO payments.payment_status_history
           (transaction_id, from_status, to_status, source, changed_by)
         VALUES ($1,'pending','succeeded','admin',$2)`,
        [tx.id, user.id],
      );
      await client.query(
        `INSERT INTO payments.payment_verification_logs
           (transaction_id, order_id, action, notes, actor_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [tx.id, tx.order_id, action, notes ?? null, user.id],
      );
      await this.applySuccessfulIntent(client, tx.payment_intent_id);
      await client.query(
        `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('payment', $1, 'payment.verified', $2::jsonb)`,
        [tx.id, JSON.stringify({ transactionId: tx.id, source: 'admin' })],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async rejectBankTransfer(
    user: AuthUser,
    transactionId: string,
    reason: string,
  ) {
    return this.rejectManualPayment(user, transactionId, reason);
  }

  async rejectManualPayment(
    user: AuthUser,
    transactionId: string,
    reason: string,
  ) {
    const { rows } = await this.db.query<{
      id: string;
      status: string;
      order_id: string;
    }>(
      `SELECT t.id, t.status, i.order_id
       FROM payments.payment_transactions t
       JOIN payments.payment_intents i ON i.id = t.payment_intent_id
       WHERE t.id = $1`,
      [transactionId],
    );
    if (!rows[0]) throw new NotFoundException('Transaction not found');
    if (rows[0].status !== 'pending') {
      throw new BadRequestException(`Cannot reject status=${rows[0].status}`);
    }
    await this.db.query(
      `UPDATE payments.payment_transactions
       SET status = 'failed', rejection_reason = $2, verified_by = $3,
           verified_at = now(), updated_at = now()
       WHERE id = $1`,
      [transactionId, reason, user.id],
    );
    await this.db.query(
      `INSERT INTO payments.payment_status_history
         (transaction_id, from_status, to_status, source, changed_by)
       VALUES ($1,'pending','failed','admin',$2)`,
      [transactionId, user.id],
    );
    await this.db.query(
      `INSERT INTO payments.payment_verification_logs
         (transaction_id, order_id, action, notes, actor_user_id)
       VALUES ($1,$2,'rejected',$3,$4)`,
      [transactionId, rows[0].order_id, reason, user.id],
    );
    await this.db.query(
      `UPDATE sales.orders
       SET payment_status = 'unpaid', updated_at = now()
       WHERE id = $1 AND payment_status = 'pending_verification'`,
      [rows[0].order_id],
    );
    return { ok: true };
  }

  async requestClarification(
    user: AuthUser,
    transactionId: string,
    notes: string,
  ) {
    const { rows } = await this.db.query<{ id: string; order_id: string }>(
      `SELECT t.id, i.order_id
       FROM payments.payment_transactions t
       JOIN payments.payment_intents i ON i.id = t.payment_intent_id
       WHERE t.id = $1`,
      [transactionId],
    );
    if (!rows[0]) throw new NotFoundException('Transaction not found');
    await this.db.query(
      `INSERT INTO payments.payment_verification_logs
         (transaction_id, order_id, action, notes, actor_user_id)
       VALUES ($1,$2,'clarification_requested',$3,$4)`,
      [transactionId, rows[0].order_id, notes, user.id],
    );
    return { ok: true };
  }

  async flagDuplicate(user: AuthUser, transactionId: string, notes?: string) {
    const { rows } = await this.db.query<{ id: string; order_id: string }>(
      `SELECT t.id, i.order_id
       FROM payments.payment_transactions t
       JOIN payments.payment_intents i ON i.id = t.payment_intent_id
       WHERE t.id = $1`,
      [transactionId],
    );
    if (!rows[0]) throw new NotFoundException('Transaction not found');
    await this.db.query(
      `INSERT INTO payments.payment_verification_logs
         (transaction_id, order_id, action, notes, actor_user_id)
       VALUES ($1,$2,'flagged_duplicate',$3,$4)`,
      [transactionId, rows[0].order_id, notes ?? 'Possible duplicate TXN ID', user.id],
    );
    return { ok: true };
  }

  async listVerificationLogs(transactionId: string) {
    const { rows } = await this.db.query<{
      id: string;
      action: string;
      notes: string | null;
      actor_user_id: string | null;
      created_at: Date;
      actor_name: string | null;
    }>(
      `SELECT l.id::text, l.action, l.notes, l.actor_user_id, l.created_at, u.full_name AS actor_name
       FROM payments.payment_verification_logs l
       LEFT JOIN iam.users u ON u.id = l.actor_user_id
       WHERE l.transaction_id = $1
       ORDER BY l.created_at DESC`,
      [transactionId],
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      notes: r.notes,
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      createdAt: r.created_at,
    }));
  }

  private async markTransactionSucceeded(
    merchantReference: string,
    source: 'webhook' | 'verify_api',
  ) {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        payment_intent_id: string;
        status: string;
      }>(
        `SELECT id, payment_intent_id, status FROM payments.payment_transactions
         WHERE merchant_reference = $1 FOR UPDATE`,
        [merchantReference],
      );
      const tx = rows[0];
      if (!tx) {
        await client.query('ROLLBACK');
        return;
      }
      if (tx.status === 'succeeded') {
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `UPDATE payments.payment_transactions
         SET status = 'succeeded', completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [tx.id],
      );
      await client.query(
        `INSERT INTO payments.payment_status_history
           (transaction_id, from_status, to_status, source)
         VALUES ($1,$2,'succeeded',$3)`,
        [tx.id, tx.status, source],
      );
      await this.applySuccessfulIntent(client, tx.payment_intent_id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async applySuccessfulIntent(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    intentId: string,
  ) {
    await client.query(
      `UPDATE payments.payment_intents
       SET status = 'succeeded', updated_at = now() WHERE id = $1`,
      [intentId],
    );
    const { rows } = (await client.query(
      `SELECT order_id, amount FROM payments.payment_intents WHERE id = $1`,
      [intentId],
    )) as { rows: Array<{ order_id: string; amount: string }> };

    const orderId = rows[0]?.order_id;
    if (!orderId) return;

    await client.query(
      `UPDATE sales.orders
       SET payment_status = 'paid',
           amount_paid = $2,
           status = CASE WHEN status = 'pending_payment' THEN 'confirmed' ELSE status END,
           approval_status = CASE
             WHEN approval_status IN ('approved', 'rejected') THEN approval_status
             ELSE 'pending'
           END,
           qa_status = CASE
             WHEN qa_status IN ('passed', 'failed', 'pending') THEN qa_status
             ELSE 'not_started'
           END,
           updated_at = now()
       WHERE id = $1`,
      [orderId, rows[0].amount],
    );
    await client.query(
      `INSERT INTO sales.order_status_history (order_id, from_status, to_status, reason)
       VALUES ($1, 'pending_payment', 'confirmed', 'Payment verified')`,
      [orderId],
    );
    await client.query(
      `INSERT INTO sales.order_approvals (order_id, action, from_status, to_status, notes)
       VALUES ($1, 'submitted', 'not_required', 'pending',
               'Awaiting admin approval after payment verification')`,
      [orderId],
    );
    await client.query(
      `INSERT INTO notify.admin_alerts (alert_type, severity, title, body, order_id)
       VALUES ('pending_approval', 'warning', 'Order awaiting approval',
               'Payment verified — admin approval required', $1)`,
      [orderId],
    );
    await client.query(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ('order', $1, 'payment.succeeded', $2::jsonb)`,
      [orderId, JSON.stringify({ orderId, intentId })],
    );
  }
}
