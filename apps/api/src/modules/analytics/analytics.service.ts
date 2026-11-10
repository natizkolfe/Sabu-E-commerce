import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type DashboardFilters = {
  dateFrom?: string;
  dateTo?: string;
  paymentStatus?: string;
  approvalStatus?: string;
  qaStatus?: string;
  deliveryStatus?: string;
  contactStatus?: string;
  orderStatus?: string;
  orderType?: string;
  fulfillmentType?: string;
  categoryId?: string;
  driverId?: string;
  amountMin?: number;
  amountMax?: number;
  q?: string;
  attention?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  sortDir?: 'asc' | 'desc';
};

@Injectable()
export class AnalyticsService {
  readonly schema = 'analytics' as const;

  constructor(private readonly db: DatabaseService) {}

  async overview(days = 30) {
    const dash = await this.dashboard({
      dateFrom: new Date(Date.now() - days * 86_400_000).toISOString(),
      dateTo: new Date().toISOString(),
      page: 1,
      pageSize: 1,
    });
    return {
      periodDays: days,
      gmv: dash.kpis.confirmedRevenue,
      orderCount: dash.kpis.totalOrders,
      deliveryFees: dash.charts.revenueSplit.deliveryFees,
      averageOrderValue:
        dash.kpis.totalOrders > 0
          ? dash.kpis.confirmedRevenue / dash.kpis.totalOrders
          : 0,
      commissionRevenue: dash.charts.commissionRevenue,
      vendorsTotal: dash.charts.vendorsTotal,
      vendorsActive: dash.charts.vendorsActive,
      unpaidOrders: dash.kpis.pendingPaymentVerification,
      pendingPaymentVerifications: dash.kpis.pendingPaymentVerification,
      specialOrdersTotal: dash.charts.specialOrdersTotal,
      specialOrdersSubmitted: dash.charts.specialOrdersSubmitted,
      dailyTrend: dash.charts.dailySales,
    };
  }

  async dashboard(filters: DashboardFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const offset = (page - 1) * pageSize;
    const { clause, params } = this.buildWhere(filters);

    const { rows: kpiRows } = await this.db.query<{
      total_orders: string;
      new_orders: string;
      pending_payment: string;
      pending_approval: string;
      pending_qa: string;
      contact_required: string;
      confirmed_orders: string;
      ready_assignment: string;
      out_for_delivery: string;
      completed_orders: string;
      cancelled_orders: string;
      confirmed_revenue: string;
    }>(
      `SELECT
         count(*)::text AS total_orders,
         count(*) FILTER (
           WHERE coalesce(o.placed_at, o.created_at) >= date_trunc('day', now())
         )::text AS new_orders,
         count(*) FILTER (
           WHERE o.payment_status = 'pending_verification'
              OR EXISTS (
                   SELECT 1 FROM payments.payment_transactions t
                   JOIN payments.payment_intents pi ON pi.id = t.payment_intent_id
                   JOIN payments.payment_methods m ON m.id = t.payment_method_id
                   WHERE pi.order_id = o.id
                     AND t.status = 'pending'
                     AND m.code IN ('telebirr_manual', 'bank_transfer_manual')
                 )
         )::text AS pending_payment,
         count(*) FILTER (
           WHERE o.approval_status = 'pending' AND o.payment_status = 'paid'
         )::text AS pending_approval,
         count(*) FILTER (
           WHERE o.qa_status IN ('pending', 'not_started')
             AND o.approval_status = 'approved'
             AND o.payment_status = 'paid'
             AND o.status NOT IN ('cancelled', 'delivered', 'completed')
         )::text AS pending_qa,
         count(*) FILTER (
           WHERE o.contact_status IN ('required', 'in_progress')
              OR o.requires_manual_contact = true
         )::text AS contact_required,
         count(*) FILTER (
           WHERE o.status IN ('confirmed', 'processing') AND o.payment_status = 'paid'
         )::text AS confirmed_orders,
         count(*) FILTER (
           WHERE o.payment_status = 'paid'
             AND o.approval_status = 'approved'
             AND o.qa_status = 'passed'
             AND o.status IN ('ready_for_dispatch', 'confirmed', 'processing')
             AND NOT EXISTS (
               SELECT 1 FROM delivery.deliveries d
               WHERE d.order_id = o.id
                 AND d.status NOT IN ('cancelled', 'failed', 'returned_to_warehouse')
             )
         )::text AS ready_assignment,
         count(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM delivery.deliveries d
             WHERE d.order_id = o.id
               AND d.status IN ('assigned', 'accepted', 'picked_up', 'in_transit', 'arrived')
           )
         )::text AS out_for_delivery,
         count(*) FILTER (
           WHERE o.status IN ('delivered', 'completed')
         )::text AS completed_orders,
         count(*) FILTER (
           WHERE o.status = 'cancelled'
         )::text AS cancelled_orders,
         coalesce(sum(o.grand_total) FILTER (
           WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled')
         ), 0)::text AS confirmed_revenue
       FROM sales.orders o
       WHERE ${clause}`,
      params,
    );

    const attention = await this.attentionCounts();
    const charts = await this.chartData(filters);
    const alerts = await this.unreadAlerts(20);

    const sortCol = this.sortColumn(filters.sort);
    const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

    const listParams = [...params, pageSize, offset];
    const { rows: orders } = await this.db.query<{
      id: string;
      order_number: string;
      customer_name: string | null;
      phone: string | null;
      placed_at: Date | null;
      item_count: string;
      subtotal: string;
      delivery_fee: string;
      grand_total: string;
      telebirr_txn: string | null;
      payment_status: string;
      approval_status: string;
      qa_status: string;
      order_status: string;
      contact_status: string;
      delivery_status: string | null;
      driver_name: string | null;
      order_type: string;
      fulfillment_type: string;
      requires_manual_contact: boolean;
      pending_tx_id: string | null;
    }>(
      `SELECT o.id, o.order_number,
              o.ship_recipient_name AS customer_name,
              coalesce(o.ship_recipient_phone, o.guest_phone_e164) AS phone,
              o.placed_at,
              (SELECT count(*)::text FROM sales.order_items oi WHERE oi.order_id = o.id) AS item_count,
              o.subtotal::text, o.delivery_fee::text, o.grand_total::text,
              (
                SELECT t.provider_reference
                FROM payments.payment_transactions t
                JOIN payments.payment_intents pi ON pi.id = t.payment_intent_id
                JOIN payments.payment_methods m ON m.id = t.payment_method_id
                WHERE pi.order_id = o.id AND m.code = 'telebirr_manual'
                ORDER BY t.initiated_at DESC LIMIT 1
              ) AS telebirr_txn,
              o.payment_status, o.approval_status, o.qa_status,
              o.status AS order_status, o.contact_status,
              d.status AS delivery_status,
              dr_name.full_name AS driver_name,
              o.order_type, o.fulfillment_type, o.requires_manual_contact,
              (
                SELECT t.id::text
                FROM payments.payment_transactions t
                JOIN payments.payment_intents pi ON pi.id = t.payment_intent_id
                WHERE pi.order_id = o.id AND t.status = 'pending'
                ORDER BY t.initiated_at DESC LIMIT 1
              ) AS pending_tx_id
       FROM sales.orders o
       LEFT JOIN LATERAL (
         SELECT id, status
         FROM delivery.deliveries
         WHERE order_id = o.id AND status NOT IN ('cancelled')
         ORDER BY created_at DESC LIMIT 1
       ) d ON true
       LEFT JOIN LATERAL (
         SELECT u.full_name
         FROM delivery.driver_assignments da
         JOIN delivery.drivers dr ON dr.id = da.driver_id
         JOIN iam.users u ON u.id = dr.user_id
         WHERE da.delivery_id = d.id AND da.status IN ('offered', 'accepted', 'completed')
         ORDER BY da.offered_at DESC NULLS LAST LIMIT 1
       ) dr_name ON true
       WHERE ${clause}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const { rows: countRows } = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales.orders o WHERE ${clause}`,
      params,
    );
    const total = Number(countRows[0]?.n ?? 0);

    const k = kpiRows[0];
    return {
      kpis: {
        totalOrders: Number(k?.total_orders ?? 0),
        newOrders: Number(k?.new_orders ?? 0),
        pendingPaymentVerification: Number(k?.pending_payment ?? 0),
        pendingAdminApproval: Number(k?.pending_approval ?? 0),
        pendingQaReview: Number(k?.pending_qa ?? 0),
        customerContactRequired: Number(k?.contact_required ?? 0),
        confirmedOrders: Number(k?.confirmed_orders ?? 0),
        readyForDriverAssignment: Number(k?.ready_assignment ?? 0),
        outForDelivery: Number(k?.out_for_delivery ?? 0),
        completedOrders: Number(k?.completed_orders ?? 0),
        cancelledOrders: Number(k?.cancelled_orders ?? 0),
        confirmedRevenue: Number(k?.confirmed_revenue ?? 0),
      },
      attention,
      alerts,
      charts,
      orders: {
        items: orders.map((o) => ({
          id: o.id,
          orderNumber: o.order_number,
          customerName: o.customer_name,
          phone: o.phone,
          placedAt: o.placed_at,
          itemCount: Number(o.item_count),
          productTotal: Number(o.subtotal),
          deliveryFee: Number(o.delivery_fee),
          totalAmount: Number(o.grand_total),
          telebirrTxnId: o.telebirr_txn,
          paymentStatus: o.payment_status,
          approvalStatus: o.approval_status,
          qaStatus: o.qa_status,
          orderStatus: o.order_status,
          deliveryStatus: o.delivery_status,
          contactStatus: o.contact_status,
          assignedDriver: o.driver_name,
          orderType: o.order_type,
          fulfillmentType: o.fulfillment_type,
          requiresManualContact: o.requires_manual_contact,
          pendingTransactionId: o.pending_tx_id,
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      filtersApplied: filters,
    };
  }

  private async attentionCounts() {
    const { rows } = await this.db.query<{
      pending_payment: string;
      pending_approval: string;
      pending_qa: string;
      contact_required: string;
      ready_assignment: string;
      overdue_approval: string;
      overdue_contact: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM payments.payment_transactions t
          JOIN payments.payment_methods m ON m.id = t.payment_method_id
          WHERE t.status = 'pending'
            AND m.code IN ('telebirr_manual', 'bank_transfer_manual')) AS pending_payment,
         (SELECT count(*)::text FROM sales.orders
          WHERE approval_status = 'pending' AND payment_status = 'paid') AS pending_approval,
         (SELECT count(*)::text FROM sales.orders
          WHERE approval_status = 'approved'
            AND qa_status IN ('pending', 'not_started')
            AND payment_status = 'paid'
            AND status NOT IN ('cancelled', 'delivered', 'completed')) AS pending_qa,
         (SELECT count(*)::text FROM sales.orders
          WHERE contact_status IN ('required', 'in_progress')
             OR requires_manual_contact = true) AS contact_required,
         (SELECT count(*)::text FROM sales.orders o
          WHERE o.payment_status = 'paid'
            AND o.approval_status = 'approved'
            AND o.qa_status = 'passed'
            AND o.status IN ('ready_for_dispatch', 'confirmed', 'processing')
            AND NOT EXISTS (
              SELECT 1 FROM delivery.deliveries d
              WHERE d.order_id = o.id
                AND d.status NOT IN ('cancelled', 'failed', 'returned_to_warehouse')
            )) AS ready_assignment,
         (SELECT count(*)::text FROM sales.orders
          WHERE approval_status = 'pending'
            AND payment_status = 'paid'
            AND coalesce(placed_at, created_at) < now() - interval '4 hours') AS overdue_approval,
         (SELECT count(*)::text FROM sales.orders
          WHERE (contact_status IN ('required', 'in_progress') OR requires_manual_contact)
            AND coalesce(placed_at, created_at) < now() - interval '2 hours') AS overdue_contact`,
    );
    const r = rows[0];
    return {
      pendingPaymentVerification: {
        count: Number(r?.pending_payment ?? 0),
        overdue: 0,
      },
      pendingAdminApproval: {
        count: Number(r?.pending_approval ?? 0),
        overdue: Number(r?.overdue_approval ?? 0),
      },
      pendingQaReview: {
        count: Number(r?.pending_qa ?? 0),
        overdue: 0,
      },
      customerContactRequired: {
        count: Number(r?.contact_required ?? 0),
        overdue: Number(r?.overdue_contact ?? 0),
      },
      readyForDriverAssignment: {
        count: Number(r?.ready_assignment ?? 0),
        overdue: 0,
      },
    };
  }

  private async chartData(filters: DashboardFilters) {
    const { clause, params } = this.buildWhere(filters);

    const { rows: byStatus } = await this.db.query<{
      status: string;
      n: string;
    }>(
      `SELECT o.status, count(*)::text AS n
       FROM sales.orders o
       WHERE ${clause}
       GROUP BY o.status
       ORDER BY count(*) DESC`,
      params,
    );

    const { rows: daily } = await this.db.query<{
      day: Date;
      order_count: string;
      gmv: string;
      paid_gmv: string;
    }>(
      `SELECT date_trunc('day', coalesce(o.placed_at, o.created_at)) AS day,
              count(*)::text AS order_count,
              coalesce(sum(o.grand_total),0)::text AS gmv,
              coalesce(sum(o.grand_total) FILTER (WHERE o.payment_status = 'paid'),0)::text AS paid_gmv
       FROM sales.orders o
       WHERE ${clause}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    const { rows: revenue } = await this.db.query<{
      product: string;
      delivery: string;
    }>(
      `SELECT
         coalesce(sum(o.subtotal) FILTER (WHERE o.payment_status = 'paid'),0)::text AS product,
         coalesce(sum(o.delivery_fee) FILTER (WHERE o.payment_status = 'paid'),0)::text AS delivery
       FROM sales.orders o
       WHERE ${clause}`,
      params,
    );

    const { rows: qa } = await this.db.query<{
      passed: string;
      failed: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE qa_status = 'passed')::text AS passed,
         count(*) FILTER (WHERE qa_status = 'failed')::text AS failed
       FROM sales.orders o
       WHERE ${clause}`,
      params,
    );

    const { rows: categories } = await this.db.query<{
      category: string;
      revenue: string;
    }>(
      `SELECT coalesce(c.name, 'Uncategorized') AS category,
              coalesce(sum(oi.line_total),0)::text AS revenue
       FROM sales.order_items oi
       JOIN sales.orders o ON o.id = oi.order_id
       LEFT JOIN catalog.product_variants pv ON pv.id = oi.variant_id
       LEFT JOIN catalog.products p ON p.id = pv.product_id
       LEFT JOIN catalog.categories c ON c.id = p.category_id
       WHERE ${clause} AND o.payment_status = 'paid'
       GROUP BY coalesce(c.name, 'Uncategorized')
       ORDER BY sum(oi.line_total) DESC
       LIMIT 8`,
      params,
    );

    const { rows: commissions } = await this.db.query<{ total: string }>(
      `SELECT coalesce(sum(commission_amount),0)::text AS total
       FROM marketplace.commission_entries
       WHERE entry_type = 'sale'`,
    );
    const { rows: vendors } = await this.db.query<{
      total: string;
      active: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'active')::text AS active
       FROM marketplace.vendors`,
    );
    const { rows: special } = await this.db.query<{
      total: string;
      submitted: string;
    }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'submitted')::text AS submitted
       FROM procurement.special_order_requests`,
    );

    return {
      ordersByStatus: byStatus.map((r) => ({
        status: r.status,
        count: Number(r.n),
      })),
      dailySales: daily.map((d) => ({
        day: d.day,
        orderCount: Number(d.order_count),
        gmv: Number(d.gmv),
        paidGmv: Number(d.paid_gmv),
      })),
      revenueSplit: {
        productRevenue: Number(revenue[0]?.product ?? 0),
        deliveryFees: Number(revenue[0]?.delivery ?? 0),
      },
      qaRates: {
        passed: Number(qa[0]?.passed ?? 0),
        failed: Number(qa[0]?.failed ?? 0),
      },
      revenueByCategory: categories.map((c) => ({
        category: c.category,
        revenue: Number(c.revenue),
      })),
      commissionRevenue: Number(commissions[0]?.total ?? 0),
      vendorsTotal: Number(vendors[0]?.total ?? 0),
      vendorsActive: Number(vendors[0]?.active ?? 0),
      specialOrdersTotal: Number(special[0]?.total ?? 0),
      specialOrdersSubmitted: Number(special[0]?.submitted ?? 0),
    };
  }

  private async unreadAlerts(limit: number) {
    try {
      const { rows } = await this.db.query<{
        id: string;
        alert_type: string;
        severity: string;
        title: string;
        body: string | null;
        order_id: string | null;
        created_at: Date;
      }>(
        `SELECT id, alert_type, severity, title, body, order_id, created_at
         FROM notify.admin_alerts
         WHERE is_read = false
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );
      return rows.map((a) => ({
        id: a.id,
        type: a.alert_type,
        severity: a.severity,
        title: a.title,
        body: a.body,
        orderId: a.order_id,
        createdAt: a.created_at,
      }));
    } catch {
      return [];
    }
  }

  private buildWhere(filters: DashboardFilters) {
    const params: unknown[] = [];
    const where = [`TRUE`];

    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(`coalesce(o.placed_at, o.created_at) >= $${params.length}::timestamptz`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(`coalesce(o.placed_at, o.created_at) <= $${params.length}::timestamptz`);
    }
    if (filters.paymentStatus) {
      params.push(filters.paymentStatus);
      where.push(`o.payment_status = $${params.length}`);
    }
    if (filters.approvalStatus) {
      params.push(filters.approvalStatus);
      where.push(`o.approval_status = $${params.length}`);
    }
    if (filters.qaStatus) {
      params.push(filters.qaStatus);
      where.push(`o.qa_status = $${params.length}`);
    }
    if (filters.contactStatus) {
      params.push(filters.contactStatus);
      where.push(`o.contact_status = $${params.length}`);
    }
    if (filters.orderStatus) {
      params.push(filters.orderStatus);
      where.push(`o.status = $${params.length}`);
    }
    if (filters.orderType) {
      params.push(filters.orderType);
      where.push(`o.order_type = $${params.length}`);
    }
    if (filters.fulfillmentType) {
      params.push(filters.fulfillmentType);
      where.push(`o.fulfillment_type = $${params.length}`);
    }
    if (filters.amountMin != null && !Number.isNaN(filters.amountMin)) {
      params.push(filters.amountMin);
      where.push(`o.grand_total >= $${params.length}`);
    }
    if (filters.amountMax != null && !Number.isNaN(filters.amountMax)) {
      params.push(filters.amountMax);
      where.push(`o.grand_total <= $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q}%`);
      where.push(
        `(o.order_number ILIKE $${params.length}
          OR o.ship_recipient_name ILIKE $${params.length}
          OR o.ship_recipient_phone ILIKE $${params.length}
          OR o.guest_phone_e164 ILIKE $${params.length})`,
      );
    }
    if (filters.deliveryStatus) {
      params.push(filters.deliveryStatus);
      where.push(`EXISTS (
        SELECT 1 FROM delivery.deliveries d
        WHERE d.order_id = o.id AND d.status = $${params.length}
      )`);
    }
    if (filters.driverId) {
      params.push(filters.driverId);
      where.push(`EXISTS (
        SELECT 1 FROM delivery.deliveries d
        JOIN delivery.driver_assignments da ON da.delivery_id = d.id
        WHERE d.order_id = o.id AND da.driver_id = $${params.length}::uuid
          AND da.status IN ('offered','accepted','completed')
      )`);
    }
    if (filters.categoryId) {
      params.push(filters.categoryId);
      where.push(`EXISTS (
        SELECT 1 FROM sales.order_items oi
        JOIN catalog.product_variants pv ON pv.id = oi.variant_id
        JOIN catalog.products p ON p.id = pv.product_id
        WHERE oi.order_id = o.id AND p.category_id = $${params.length}::uuid
      )`);
    }

    if (filters.attention) {
      switch (filters.attention) {
        case 'pending_payment':
          where.push(`(
            o.payment_status = 'pending_verification'
            OR EXISTS (
              SELECT 1 FROM payments.payment_transactions t
              JOIN payments.payment_intents pi ON pi.id = t.payment_intent_id
              WHERE pi.order_id = o.id AND t.status = 'pending'
            )
          )`);
          break;
        case 'pending_approval':
          where.push(`o.approval_status = 'pending' AND o.payment_status = 'paid'`);
          break;
        case 'pending_qa':
          where.push(`o.approval_status = 'approved'
            AND o.qa_status IN ('pending','not_started')
            AND o.payment_status = 'paid'
            AND o.status NOT IN ('cancelled','delivered','completed')`);
          break;
        case 'contact_required':
          where.push(`(o.contact_status IN ('required','in_progress') OR o.requires_manual_contact)`);
          break;
        case 'ready_assignment':
          where.push(`o.payment_status = 'paid'
            AND o.approval_status = 'approved'
            AND o.qa_status = 'passed'
            AND o.status IN ('ready_for_dispatch','confirmed','processing')
            AND NOT EXISTS (
              SELECT 1 FROM delivery.deliveries d
              WHERE d.order_id = o.id
                AND d.status NOT IN ('cancelled','failed','returned_to_warehouse')
            )`);
          break;
        case 'out_for_delivery':
          where.push(`EXISTS (
            SELECT 1 FROM delivery.deliveries d
            WHERE d.order_id = o.id
              AND d.status IN ('assigned','accepted','picked_up','in_transit','arrived')
          )`);
          break;
        case 'completed':
          where.push(`o.status IN ('delivered','completed')`);
          break;
        case 'cancelled':
          where.push(`o.status = 'cancelled'`);
          break;
        case 'new_today':
          where.push(`coalesce(o.placed_at, o.created_at) >= date_trunc('day', now())`);
          break;
        case 'confirmed':
          where.push(`o.status IN ('confirmed','processing') AND o.payment_status = 'paid'`);
          break;
        default:
          break;
      }
    }

    return { clause: where.join(' AND '), params };
  }

  private sortColumn(sort?: string) {
    switch (sort) {
      case 'orderNumber':
        return 'o.order_number';
      case 'customer':
        return 'o.ship_recipient_name';
      case 'amount':
        return 'o.grand_total';
      case 'paymentStatus':
        return 'o.payment_status';
      case 'approvalStatus':
        return 'o.approval_status';
      case 'qaStatus':
        return 'o.qa_status';
      case 'status':
        return 'o.status';
      case 'placedAt':
      default:
        return 'coalesce(o.placed_at, o.created_at)';
    }
  }
}
