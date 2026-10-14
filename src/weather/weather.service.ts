import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { LocationService } from '../location/location.service';

export interface Weather {
  place: string;
  temp: number;
  icon: string;
  text: string;
  isDay: boolean;
  /** Today's high and low, and the highest chance of rain for the rest of today (%). */
  hi?: number;
  lo?: number;
  rain?: number;
  /** The next hours: time "15:00", temperature, icon, chance of rain. */
  hours: { time: string; temp: number; icon: string; rain: number }[];
  at: number;
}

const REFRESH_MS = 15 * 60_000;

/** Open-Meteo's weather codes (WMO) in plain words, with a symbol. */
const CODES: [number[], string, string, string?][] = [
  [[0], '☀️', 'Clear', '🌙'],
  [[1], '🌤️', 'Mostly clear', '🌙'],
  [[2], '⛅', 'Partly cloudy', '☁️'],
  [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Fog'],
  [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'],
  [[61, 63, 65, 66, 67], '🌧️', 'Rain'],
  [[71, 73, 75, 77], '❄️', 'Snow'],
  [[80, 81, 82], '🌦️', 'Showers'],
  [[85, 86], '🌨️', 'Snow showers'],
  [[95, 96, 99], '⛈️', 'Thunderstorms'],
];

export function describeCode(code: number, isDay = true): { icon: string; text: string } {
  const c = CODES.find(([codes]) => codes.includes(code));
  if (!c) return { icon: '🌡️', text: 'Weather' };
  return { icon: !isDay && c[3] ? c[3] : c[1], text: c[2] };
}

/**
 * The weather at home, for the screen: Open-Meteo (free, no key), for the home location set on
 * the control panel (Settings → Home location). Refreshed every 15 minutes.
 */
@Injectable()
export class WeatherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Weather');
  private coords?: { key: string; lat: number; lon: number; name: string };
  private current?: Weather;
  private timer?: NodeJS.Timeout;
  private warned = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Optional() private readonly location?: LocationService,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.face.enabled) return;
    setTimeout(() => void this.refresh(), 5000);
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  get now(): Weather | undefined {
    return this.current && Date.now() - this.current.at < 3 * REFRESH_MS ? this.current : undefined;
  }

  async refresh(): Promise<Weather | undefined> {
    const home = this.location?.home;
    if (!home?.place) return undefined;
    try {
      const key = `${home.place}|${home.country}`;
      if (this.coords?.key !== key) {
        const q = new URLSearchParams({ name: home.place, count: '1', language: 'en', format: 'json', ...(home.country ? { countryCode: home.country.toUpperCase() } : {}) });
        const g = (await this.get(`https://geocoding-api.open-meteo.com/v1/search?${q}`)) as { results?: { latitude: number; longitude: number; name: string }[] };
        const r = g.results?.[0];
        if (!r) throw new Error(`"${home.place}" not found`);
        this.coords = { key, lat: r.latitude, lon: r.longitude, name: r.name };
      }
      const c = this.coords;
      const q = new URLSearchParams({
        latitude: String(c.lat),
        longitude: String(c.lon),
        current: 'temperature_2m,weather_code,is_day',
        hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
        daily: 'temperature_2m_max,temperature_2m_min',
        timezone: 'auto',
        forecast_days: '2',
      });
      const w = (await this.get(`https://api.open-meteo.com/v1/forecast?${q}`)) as {
        current: { temperature_2m: number; weather_code: number; is_day: number; time: string };
        hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[]; is_day: number[] };
        daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
      };
      const isDay = w.current.is_day === 1;
      const d = describeCode(w.current.weather_code, isDay);
      // Hours from now on (the times are the place's own local time).
      const nowHour = w.current.time.slice(0, 13);
      const start = Math.max(0, w.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
      const today = w.current.time.slice(0, 10);
      const restOfToday = w.hourly.time.map((t, i) => ({ t, i })).filter(({ t }) => t.slice(0, 10) === today && t.slice(0, 13) >= nowHour);
      this.current = {
        place: c.name,
        temp: Math.round(w.current.temperature_2m),
        icon: d.icon,
        text: d.text,
        isDay,
        hi: Math.round(w.daily.temperature_2m_max[0]),
        lo: Math.round(w.daily.temperature_2m_min[0]),
        rain: restOfToday.length ? Math.max(...restOfToday.map(({ i }) => w.hourly.precipitation_probability[i] ?? 0)) : undefined,
        hours: w.hourly.time.slice(start + 1, start + 7).map((t, k) => {
          const i = start + 1 + k;
          return { time: t.slice(11, 16), temp: Math.round(w.hourly.temperature_2m[i]), icon: describeCode(w.hourly.weather_code[i], w.hourly.is_day[i] === 1).icon, rain: w.hourly.precipitation_probability[i] ?? 0 };
        }),
        at: Date.now(),
      };
      this.warned = false;
      return this.current;
    } catch (err) {
      if (!this.warned) this.log.warn(`Weather unavailable (${(err as Error).message}); trying again later`);
      this.warned = true;
      return undefined;
    }
  }

  private async get(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'max-assistant' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }
}
