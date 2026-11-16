import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { AuthUser } from '../iam/auth.types';

export type SiteFaq = { question: string; answer: string };

export type AboutSiteContent = {
  headline: string;
  intro: string;
  phone: string;
  whatsappUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  facebookUrl: string;
  contactNote: string;
  faqs: SiteFaq[];
};

const ABOUT_DEFAULTS: AboutSiteContent = {
  headline: 'About Sabu',
  intro:
    'Sabu Online Shopping brings everyday products to your door across Ethiopia.',
  phone: '+251911129726',
  whatsappUrl: 'https://wa.me/251911129726',
  instagramUrl: 'https://instagram.com/sabu_placeholder',
  tiktokUrl: 'https://tiktok.com/@sabu_placeholder',
  facebookUrl: 'https://facebook.com/sabu_placeholder',
  contactNote:
    'Questions or issues? Call or message us, or reach out on social media.',
  faqs: [],
};

function normalizeAbout(raw: unknown): AboutSiteContent {
  const p =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const faqsRaw = Array.isArray(p.faqs) ? p.faqs : [];
  const faqs = faqsRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const q = String((item as { question?: unknown }).question ?? '').trim();
      const a = String((item as { answer?: unknown }).answer ?? '').trim();
      if (!q || !a) return null;
      return { question: q, answer: a };
    })
    .filter((x): x is SiteFaq => Boolean(x));

  return {
    headline: String(p.headline ?? ABOUT_DEFAULTS.headline).trim() || ABOUT_DEFAULTS.headline,
    intro: String(p.intro ?? ABOUT_DEFAULTS.intro).trim() || ABOUT_DEFAULTS.intro,
    phone: String(p.phone ?? ABOUT_DEFAULTS.phone).trim() || ABOUT_DEFAULTS.phone,
    whatsappUrl:
      String(p.whatsappUrl ?? ABOUT_DEFAULTS.whatsappUrl).trim() ||
      ABOUT_DEFAULTS.whatsappUrl,
    instagramUrl:
      String(p.instagramUrl ?? ABOUT_DEFAULTS.instagramUrl).trim() ||
      ABOUT_DEFAULTS.instagramUrl,
    tiktokUrl:
      String(p.tiktokUrl ?? ABOUT_DEFAULTS.tiktokUrl).trim() ||
      ABOUT_DEFAULTS.tiktokUrl,
    facebookUrl:
      String(p.facebookUrl ?? ABOUT_DEFAULTS.facebookUrl).trim() ||
      ABOUT_DEFAULTS.facebookUrl,
    contactNote:
      String(p.contactNote ?? ABOUT_DEFAULTS.contactNote).trim() ||
      ABOUT_DEFAULTS.contactNote,
    faqs,
  };
}

/** Owns PostgreSQL schema core. Cross-module side effects via core.outbox_events. */
@Injectable()
export class CoreService {
  readonly schema = 'core' as const;

  constructor(private readonly db: DatabaseService) {}

  async getAboutContent(): Promise<AboutSiteContent> {
    const { rows } = await this.db.query<{ payload: unknown }>(
      `SELECT payload FROM core.site_content WHERE key = 'about'`,
    );
    if (!rows[0]) return { ...ABOUT_DEFAULTS };
    return normalizeAbout(rows[0].payload);
  }

  async updateAboutContent(
    actor: AuthUser,
    body: Partial<AboutSiteContent>,
  ): Promise<AboutSiteContent> {
    const current = await this.getAboutContent();
    const next = normalizeAbout({
      ...current,
      ...body,
      faqs: body.faqs !== undefined ? body.faqs : current.faqs,
    });

    if (!/^\+[1-9][0-9]{7,14}$/.test(next.phone)) {
      throw new BadRequestException('Phone must be E.164 (+251...)');
    }
    for (const urlKey of [
      'whatsappUrl',
      'instagramUrl',
      'tiktokUrl',
      'facebookUrl',
    ] as const) {
      const url = next[urlKey];
      if (!/^https?:\/\//i.test(url)) {
        throw new BadRequestException(`${urlKey} must start with http(s)://`);
      }
    }
    if (next.faqs.length > 40) {
      throw new BadRequestException('Too many FAQs (max 40)');
    }

    const { rowCount } = await this.db.query(
      `INSERT INTO core.site_content (key, payload, updated_at, updated_by)
       VALUES ('about', $1::jsonb, now(), $2)
       ON CONFLICT (key) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(next), actor.id],
    );
    if (!rowCount) throw new NotFoundException('Could not save site content');
    return next;
  }
}
