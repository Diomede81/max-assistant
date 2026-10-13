import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { MemoryService } from '../memory/memory.service';
import { memorySecret, SealedStore } from '../memory/sealed-store';

export interface HomeLocation {
  /** Town, city or area, e.g. "Clapham, London". */
  place: string;
  /** Optional postcode (or its first half, e.g. "SW4"): sharper local results. */
  postcode?: string;
  /** ISO country code, e.g. GB. */
  country: string;
}

/** Common countries for the control panel (any ISO code also works from .env). */
export const COUNTRIES: Record<string, string> = {
  GB: 'United Kingdom', IE: 'Ireland', IT: 'Italy', FR: 'France', ES: 'Spain', DE: 'Germany', PT: 'Portugal',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', US: 'United States', CA: 'Canada',
  AU: 'Australia', NZ: 'New Zealand', AE: 'United Arab Emirates',
};

/**
 * Where home is. Set on the control panel (or HOME_LOCATION / HOME_COUNTRY in .env as a default),
 * kept encrypted next to the memory. Max is told it at the start of every conversation, so local
 * questions (weather, opening hours, events, "near me") are about the right place, and web
 * searches are geo-targeted to it.
 */
@Injectable()
export class LocationService implements OnModuleInit {
  private readonly log = new Logger('Location');
  private saved?: HomeLocation;
  private store?: SealedStore<HomeLocation>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    // Injected so the memory key exists before the store is opened.
    @Optional() private readonly memory?: MemoryService,
  ) {}

  onModuleInit(): void {
    this.store = new SealedStore(this.cfg.memory.dir, 'location', memorySecret(this.cfg));
    try {
      const s = this.store.load();
      if (s?.place) this.saved = s;
    } catch (err) {
      this.log.warn(`Could not read the saved home location (${(err as Error).message})`);
    }
    const h = this.home;
    this.log.log(h ? `Home location: ${describe(h)}` : 'No home location set: add it on the control panel for local answers');
  }

  /** The saved location, else the .env default, else nothing. */
  get home(): HomeLocation | undefined {
    if (this.saved) return this.saved;
    const place = this.cfg.location.place.trim();
    return place ? { place, country: this.cfg.location.country } : undefined;
  }

  get country(): string {
    return this.home?.country ?? this.cfg.location.country;
  }

  async save(loc: { place?: string; postcode?: string; country?: string }): Promise<string> {
    const place = (loc.place ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const country = (loc.country ?? '').trim().toUpperCase();
    if (!place) return 'Enter a town, city or area.';
    if (!/^[A-Z]{2}$/.test(country)) return 'Choose a country.';
    const postcode = (loc.postcode ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 10) || undefined;
    this.saved = { place, postcode, country };
    await this.store?.save(this.saved);
    this.log.log(`Home location set: ${describe(this.saved)}`);
    return `Saved: ${describe(this.saved)}. Max uses it from the next question.`;
  }

  /**
   * For the start of each conversation. In guest mode only the town (no postcode): visitors
   * don't need the household's exact address read out.
   */
  promptLine(guest = false): string {
    const h = this.home;
    if (!h) return '';
    const where = `${h.place}${h.postcode && !guest ? ` (postcode ${h.postcode})` : ''}, ${COUNTRIES[h.country] ?? h.country}`;
    return (
      `Home is in ${where}. For anything local (weather, opening hours, shops and restaurants nearby, events, ` +
      'local news, travel, "near me") assume this place unless the user names another, and include it in web ' +
      'searches (e.g. "pharmacy open now Clapham").'
    );
  }

  /** Firecrawl's search location, e.g. "Clapham, London, United Kingdom". */
  get searchLocation(): string | undefined {
    const h = this.home;
    return h ? `${h.place}, ${COUNTRIES[h.country] ?? h.country}` : undefined;
  }
}

export function describe(h: HomeLocation): string {
  return `${h.place}${h.postcode ? ` ${h.postcode}` : ''}, ${COUNTRIES[h.country] ?? h.country}`;
}
