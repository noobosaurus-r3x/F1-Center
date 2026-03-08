import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { buildEndpointUrl, fetchOpenF1, type QueryValue } from './lib/openf1';
import {
  average,
  compactNumber,
  downsample,
  formatDateTime,
  formatDurationSeconds,
  formatValue,
  parseOpenF1Date,
  sortByDate,
  toNumeric,
} from './lib/format';

type TabKey = 'results' | 'driver' | 'weather' | 'telemetry' | 'events';
type WindowPreset = 'full' | '15m' | '5m';
type OpenF1Row = Record<string, unknown>;

interface Meeting extends OpenF1Row {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name?: string;
  location?: string;
  country_name?: string;
  country_code?: string;
  circuit_short_name?: string;
  circuit_type?: string;
  circuit_image?: string;
  date_start?: string;
  date_end?: string;
  year?: number;
}

interface Session extends OpenF1Row {
  session_key: number;
  session_name: string;
  session_type?: string;
  meeting_key: number;
  date_start?: string;
  date_end?: string;
  location?: string;
}

interface Driver extends OpenF1Row {
  driver_number: number;
  full_name?: string;
  broadcast_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  headshot_url?: string;
}

interface SessionResult extends OpenF1Row {
  driver_number: number;
  position?: number;
  points?: number;
  duration?: number | string;
  gap_to_leader?: string;
  number_of_laps?: number;
  dnf?: boolean;
  dns?: boolean;
  dsq?: boolean;
  team_name?: string;
  meeting_key?: number;
  session_key?: number;
}

interface StartingGridRow extends OpenF1Row {
  driver_number: number;
  position?: number;
  lap_duration?: number;
  meeting_key?: number;
  session_key?: number;
}

interface LapRow extends OpenF1Row {
  driver_number: number;
  lap_number?: number;
  lap_duration?: number;
  date_start?: string;
  is_pit_out_lap?: boolean;
}

interface StintRow extends OpenF1Row {
  driver_number: number;
  stint_number?: number;
  compound?: string;
  lap_start?: number;
  lap_end?: number;
  tyre_age_at_start?: number;
}

interface IntervalRow extends OpenF1Row {
  date: string;
  driver_number: number;
  interval?: string;
  gap_to_leader?: string;
}

interface PositionRow extends OpenF1Row {
  date: string;
  driver_number: number;
  position?: number;
}

interface RaceControlMessage extends OpenF1Row {
  date: string;
  category?: string;
  flag?: string;
  message?: string;
  lap_number?: number;
  driver_number?: number;
}

interface ChampionshipDriverRow extends OpenF1Row {
  driver_number: number;
  points_current?: number;
  points_start?: number;
  position_current?: number;
  position_start?: number;
}

interface ChampionshipTeamRow extends OpenF1Row {
  team_name?: string;
  points_current?: number;
  points_start?: number;
  position_current?: number;
  position_start?: number;
}

interface PitRow extends OpenF1Row {
  date: string;
  driver_number: number;
  lap_number?: number;
  lane_duration?: number;
  pit_duration?: number;
  stop_duration?: number;
}

interface OvertakeRow extends OpenF1Row {
  date: string;
  overtaking_driver_number?: number;
  overtaken_driver_number?: number;
  position?: number;
}

interface WeatherSample extends OpenF1Row {
  date: string;
  air_temperature?: number;
  track_temperature?: number;
  humidity?: number;
  rainfall?: number;
  wind_speed?: number;
  wind_direction?: number;
}

interface CarDataSample extends OpenF1Row {
  date: string;
  driver_number: number;
  speed?: number;
  throttle?: number;
  brake?: number;
  rpm?: number;
  n_gear?: number;
  drs?: number;
}

interface LocationSample extends OpenF1Row {
  date: string;
  x?: number;
  y?: number;
  z?: number;
  driver_number: number;
}

interface QueryState<T extends OpenF1Row> {
  data: T[];
  loading: boolean;
  error: string | null;
  url: string;
}

interface ClassificationEntry {
  driverNumber: number;
  position: number;
  gridPosition: number | null;
  positionDelta: number | null;
  teamName: string;
  accent: string;
  gapLabel: string;
  leaderTime: string | null;
  bestLap: number | null;
  compound: string | null;
  tyreAge: number | null;
  driver: Driver | undefined;
  interval?: string;
  gapToLeader?: string;
}

interface PlotSeries {
  label: string;
  color: string;
  values: Array<number | null>;
  dashArray?: string;
  strokeWidth?: number;
  opacity?: number;
}

interface EventFeedItem {
  id: string;
  date: string;
  tone: string;
  headline: string;
  body: string;
  priority: number;
  sourceType: 'race_control' | 'pit' | 'overtake';
  driverNumber?: number;
  sourceLabel?: string;
  lapLabel?: string;
  badge?: string;
}

interface DriverStandingEntry {
  driverNumber: number;
  position: number;
  positionDelta: number | null;
  points: number;
  leaderGap: number;
  driver: Driver | undefined;
  accent: string;
  teamName: string;
}

interface TeamStandingEntry {
  teamName: string;
  position: number;
  positionDelta: number | null;
  points: number;
  leaderGap: number;
  accent: string;
}

interface RaceSummaryStat {
  label: string;
  value: string;
  tone?: string;
  detail?: string;
}

interface DriverSeasonRaceEntry {
  meetingKey: number;
  sessionKey: number;
  meetingLabel: string;
  dateLabel: string;
  locationLabel: string;
  position: number | null;
  gridPosition: number | null;
  points: number;
  lapsCompleted: number | null;
  statusLabel: string | null;
  gapLabel: string;
  completed: boolean;
}

const TABS: Array<{ key: TabKey; label: string; detail: string }> = [
  { key: 'results', label: 'Résultats', detail: 'Podium, classement et écarts.' },
  { key: 'driver', label: 'Pilotes', detail: 'Fiche saison, points et résultats course par course.' },
  { key: 'weather', label: 'Météo', detail: 'Température et conditions de piste.' },
  { key: 'telemetry', label: 'Télémétrie', detail: 'Comparaison des leaders.' },
  { key: 'events', label: 'Événements', detail: 'Course, stands, drapeaux et dépassements.' },
];

const WINDOW_OPTIONS: WindowPreset[] = ['full', '15m', '5m'];
const LIVE_REFRESH_MS = 12000;
const WEATHER_REFRESH_MS = 30000;
const INTEGRATED_ENDPOINT_KEYS = [
  'meetings',
  'sessions',
  'drivers',
  'weather',
  'race_control',
  'car_data',
  'location',
  'position',
  'laps',
  'pit',
  'stints',
  'intervals',
  'overtakes',
  'session_result',
  'starting_grid',
  'championship_drivers',
  'championship_teams',
] as const;

const TEAM_COLORS: Record<string, string> = {
  ferrari: '#E8002D',
  mercedes: '#27F4D2',
  'red bull': '#3671C6',
  'red bull racing': '#3671C6',
  mclaren: '#FF8000',
  audi: '#FF2D00',
  cadillac: '#AAAAAD',
  williams: '#64C4FF',
  alpine: '#FF87BC',
  'aston martin': '#229971',
  'haas f1 team': '#B6BABD',
  haas: '#B6BABD',
  'racing bulls': '#6692FF',
  rb: '#6692FF',
  sauber: '#52E252',
  'stake f1 team kick sauber': '#52E252',
  'kick sauber': '#52E252',
};

const TYRE_META: Record<string, { label: string; color: string; ring?: string }> = {
  SOFT: { label: 'Tendre', color: '#FF3333' },
  MEDIUM: { label: 'Médium', color: '#F9D71C' },
  HARD: { label: 'Dur', color: '#F3F4F6', ring: '#4A4E57' },
  INTERMEDIATE: { label: 'Inter', color: '#00B050' },
  WET: { label: 'Pluie', color: '#1A6BFF' },
};

const STATUS_LABELS: Array<{ key: keyof SessionResult; label: string }> = [
  { key: 'dnf', label: 'Abandon' },
  { key: 'dns', label: 'Non-partant' },
  { key: 'dsq', label: 'Disqualifié' },
];

const regionNames = typeof Intl !== 'undefined' ? new Intl.DisplayNames(['fr'], { type: 'region' }) : null;
const COUNTRY_CODE_MAP: Record<string, string> = {
  ARE: 'AE',
  AUS: 'AU',
  AUT: 'AT',
  AZE: 'AZ',
  BAH: 'BH',
  BHR: 'BH',
  BEL: 'BE',
  BRA: 'BR',
  CAN: 'CA',
  CHN: 'CN',
  ESP: 'ES',
  GBR: 'GB',
  HUN: 'HU',
  ITA: 'IT',
  JPN: 'JP',
  MCO: 'MC',
  MEX: 'MX',
  NLD: 'NL',
  QAT: 'QA',
  SAU: 'SA',
  SGP: 'SG',
  USA: 'US',
};
const COUNTRY_NAME_MAP: Record<string, string> = {
  Australia: 'Australie',
  Austria: 'Autriche',
  Azerbaijan: 'Azerbaïdjan',
  Bahrain: 'Bahreïn',
  Belgium: 'Belgique',
  Brazil: 'Brésil',
  Canada: 'Canada',
  China: 'Chine',
  Hungary: 'Hongrie',
  Italy: 'Italie',
  Japan: 'Japon',
  Mexico: 'Mexique',
  Monaco: 'Monaco',
  Netherlands: 'Pays-Bas',
  Qatar: 'Qatar',
  'Saudi Arabia': 'Arabie saoudite',
  Singapore: 'Singapour',
  Spain: 'Espagne',
  'United Arab Emirates': 'Émirats arabes unis',
  'United Kingdom': 'Royaume-Uni',
  'United States': 'États-Unis',
};

function useEndpointData<T extends OpenF1Row>(
  path: string,
  params: Record<string, QueryValue>,
  enabled = true,
  refreshMs = 0,
): QueryState<T> {
  const url = useMemo(() => (enabled ? buildEndpointUrl(path, params) : ''), [enabled, params, path]);
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: false, error: null, url });

  useEffect(() => {
    if (!enabled || !url) {
      setState({ data: [], loading: false, error: null, url: '' });
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const load = async (showLoading: boolean) => {
      if (showLoading) {
        setState((current) => ({ ...current, loading: true, error: null, url }));
      } else {
        setState((current) => ({ ...current, error: null, url }));
      }

      try {
        const data = await fetchOpenF1<T>(url, { force: refreshMs > 0 });
        if (!cancelled) {
          setState({ data, loading: false, error: null, url });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setState((current) => ({
            data: showLoading ? [] : current.data,
            loading: false,
            error: error instanceof Error ? error.message : 'Requête impossible',
            url,
          }));
        }
      }
    };

    void load(true);

    if (refreshMs > 0) {
      intervalId = window.setInterval(() => {
        void load(false);
      }, refreshMs);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [enabled, refreshMs, url]);

  return state;
}

const getCurrentYear = () => new Date().getUTCFullYear();
const safeText = (value: unknown, fallback = 'n/d') => (value === null || value === undefined || value === '' ? fallback : String(value));
const getDriverName = (driver: Driver | undefined) => driver?.full_name || driver?.broadcast_name || 'Pilote inconnu';
const getDriverCode = (driver: Driver | undefined) => driver?.name_acronym || driver?.broadcast_name || getDriverName(driver).slice(0, 3).toUpperCase();

const normalizeTeamKey = (value?: string | null) =>
  String(value || '')
    .toLowerCase()
    .replace(/scuderia /g, '')
    .replace(/f1 team/g, 'f1 team')
    .trim();

const getTeamName = (teamName?: string | null, driver?: Driver) => teamName || driver?.team_name || 'Équipe inconnue';
const getTeamColor = (teamName?: string | null, driver?: Driver) => {
  const normalized = normalizeTeamKey(teamName || driver?.team_name);
  const match = Object.entries(TEAM_COLORS).find(([key]) => normalized.includes(key));
  if (match) {
    return match[1];
  }

  if (driver?.team_colour) {
    return `#${driver.team_colour}`;
  }

  return '#5A6072';
};

const getCountryLabel = (countryCode?: string | null, fallback?: string | null) => {
  const normalizedCode = countryCode ? COUNTRY_CODE_MAP[countryCode] || countryCode : null;

  if (normalizedCode && regionNames) {
    try {
      const translated = regionNames.of(normalizedCode);
      if (translated) {
        return translated;
      }
    } catch {
      return fallback ? COUNTRY_NAME_MAP[fallback] || fallback : 'n/d';
    }
  }

  return fallback ? COUNTRY_NAME_MAP[fallback] || fallback : 'n/d';
};

const getSessionLabel = (value?: string | null) => {
  switch ((value || '').toLowerCase()) {
    case 'practice 1':
      return 'Essais libres 1';
    case 'practice 2':
      return 'Essais libres 2';
    case 'practice 3':
      return 'Essais libres 3';
    case 'qualifying':
      return 'Qualifications';
    case 'sprint':
      return 'Sprint';
    case 'sprint qualifying':
      return 'Qualifications sprint';
    case 'race':
      return 'Course';
    default:
      return value || 'n/d';
  }
};

const getSessionTypeLabel = (value?: string | null) => {
  switch ((value || '').toLowerCase()) {
    case 'practice':
      return 'Essais';
    case 'qualifying':
      return 'Qualifications';
    case 'race':
      return 'Course';
    case 'sprint':
      return 'Sprint';
    default:
      return value || 'n/d';
  }
};

const isRaceSession = (session?: Session | null) => {
  const type = session?.session_type?.toLowerCase();
  const name = session?.session_name?.toLowerCase();
  return type === 'race' || name === 'race';
};

const isGrandPrixRaceSession = (session?: Session | null) =>
  isRaceSession(session) && session?.session_name?.toLowerCase() === 'race';

const isQualifyingSession = (session?: Session | null) => {
  const type = session?.session_type?.toLowerCase();
  const name = session?.session_name?.toLowerCase();
  return type === 'qualifying' || name === 'qualifying';
};

const isGrandPrixQualifyingSession = (session?: Session | null) =>
  isQualifyingSession(session) && session?.session_name?.toLowerCase() === 'qualifying';

const getMeetingLabel = (meeting?: Meeting | null) => {
  if (!meeting) {
    return 'Grand Prix';
  }

  const rawName = meeting.meeting_name || '';
  if (/testing/i.test(rawName)) {
    return 'Essais de pré-saison';
  }

  if (/grand prix/i.test(rawName)) {
    return `Grand Prix ${getCountryLabel(meeting.country_code, meeting.country_name)}`;
  }

  return rawName || 'Grand Prix';
};

const formatDateLabel = (value?: string | null) => {
  if (!value) {
    return 'n/d';
  }

  const timestamp = parseOpenF1Date(value);
  if (Number.isNaN(timestamp)) {
    return String(value);
  }

  return new Date(timestamp).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
};

const formatMeetingDateRange = (meeting?: Meeting | null) => {
  if (!meeting?.date_start || !meeting?.date_end) {
    return 'Dates n/d';
  }

  const start = parseOpenF1Date(meeting.date_start);
  const end = parseOpenF1Date(meeting.date_end);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return `${formatDateLabel(meeting.date_start)} - ${formatDateLabel(meeting.date_end)}`;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameMonth =
    startDate.getUTCMonth() === endDate.getUTCMonth() && startDate.getUTCFullYear() === endDate.getUTCFullYear();

  if (sameMonth) {
    return `${startDate.getUTCDate()}-${endDate.getUTCDate()} ${endDate.toLocaleDateString('fr-FR', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })}`;
  }

  return `${formatDateLabel(meeting.date_start)} - ${formatDateLabel(meeting.date_end)}`;
};

const getMeetingOptionLabel = (meeting: Meeting) => {
  const location = meeting.circuit_short_name || meeting.location;
  const dateRange = formatMeetingDateRange(meeting);
  return location ? `${getMeetingLabel(meeting)} · ${location} · ${dateRange}` : `${getMeetingLabel(meeting)} · ${dateRange}`;
};

const getSessionPhase = (session: Session | undefined, now = Date.now()) => {
  if (!session?.date_start || !session?.date_end) {
    return 'unknown';
  }

  const start = parseOpenF1Date(session.date_start);
  const end = parseOpenF1Date(session.date_end);

  if (now < start) {
    return 'upcoming';
  }

  if (now > end) {
    return 'ended';
  }

  return 'live';
};

const getSessionState = (session: Session | undefined, now = Date.now()) => {
  switch (getSessionPhase(session, now)) {
    case 'upcoming':
      return 'Session à venir';
    case 'ended':
      return 'Session terminée';
    case 'live':
      return 'Session en cours';
    default:
      return 'Contexte chargé';
  }
};

const toTimeLabel = (value?: string | null) => {
  if (!value) {
    return 'n/d';
  }

  const timestamp = parseOpenF1Date(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const formatRaceTime = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') {
    return 'n/d';
  }

  if (typeof value === 'string' && value.includes(':')) {
    return value;
  }

  const numericValue = toNumeric(value);
  if (numericValue === null) {
    return String(value);
  }

  const hours = Math.floor(numericValue / 3600);
  const minutes = Math.floor((numericValue % 3600) / 60);
  const seconds = numericValue % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds.toFixed(1)}s`;
  }

  return formatDurationSeconds(numericValue);
};

const formatGapDisplay = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return 'n/d';
  }

  const text = String(value).trim();
  if (/abandon|non-partant|disqualifi/i.test(text)) {
    return text;
  }

  if (/lap/i.test(text)) {
    return text.startsWith('+') ? text : `+${text}`;
  }

  if (/^[\d.]+$/.test(text)) {
    return `+${text}s`;
  }

  return text.startsWith('+') ? text : text;
};

const getTyreLabel = (compound: string | null | undefined) => {
  const meta = TYRE_META[String(compound || '').toUpperCase()];
  return meta?.label || safeText(compound);
};

const getTyreShortLabel = (compound: string | null | undefined) => {
  const normalized = String(compound || '').toUpperCase();
  switch (normalized) {
    case 'SOFT':
      return 'S';
    case 'MEDIUM':
      return 'M';
    case 'HARD':
      return 'H';
    case 'INTERMEDIATE':
      return 'I';
    case 'WET':
      return 'W';
    default:
      return safeText(compound);
  }
};

const formatTyreAge = (age: number | null) => {
  if (!age) {
    return 'n/d';
  }

  return `${age} ${age > 1 ? 'tours' : 'tour'}`;
};

const formatTyreAgeShort = (age: number | null) => {
  if (!age) {
    return 'n/d';
  }

  return `${age}t`;
};

const parseGapSeconds = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (/lap/i.test(value)) {
    return 99;
  }

  return toNumeric(value);
};

const getStatusLabel = (row: SessionResult | undefined) => {
  if (!row) {
    return null;
  }

  const status = STATUS_LABELS.find((entry) => Boolean(row[entry.key]));
  return status?.label ?? null;
};

const getEventToneByPriority = (priority: number) => {
  if (priority >= 90) {
    return 'is-alert';
  }
  if (priority >= 70) {
    return 'is-warn';
  }
  if (priority >= 45) {
    return 'is-ok';
  }
  return 'is-neutral';
};

const getRaceControlRawText = (row: RaceControlMessage) =>
  `${row.flag || ''} ${row.category || ''} ${row.message || ''}`.toLowerCase();

const isNoiseRaceControlMessage = (row: RaceControlMessage) => {
  const raw = getRaceControlRawText(row);
  return (
    /blue flag/.test(raw) ||
    /clear in track sector/.test(raw) ||
    /track clear/.test(raw) ||
    /all pass holders/.test(raw) ||
    /drs (enabled|disabled)/.test(raw) ||
    /lap time deleted/.test(raw) ||
    /time .* deleted/.test(raw) ||
    /practice start/.test(raw) ||
    /pit exit open/.test(raw) ||
    /pit exit closed/.test(raw) ||
    /black and white flag/.test(raw) ||
    /session finished/.test(raw) ||
    /session started/.test(raw)
  );
};

const getRaceControlPriority = (row: RaceControlMessage) => {
  const raw = getRaceControlRawText(row);

  if (/\bred flag\b|session stopped/.test(raw)) {
    return 100;
  }
  if (/chequered/.test(raw)) {
    return 66;
  }
  if (/vsc deployed|virtual safety car deployed|sc deployed|safety car deployed/.test(raw)) {
    return 96;
  }
  if (/retired|has stopped|stopped on track|abandon|medical car/.test(raw)) {
    return 94;
  }
  if (/disqualified|\bblack flag\b|stop\/go|drive through|penalty/.test(raw)) {
    return 92;
  }
  if (/investigation|noted|summoned|unsafe release/.test(raw)) {
    return 84;
  }
  if (/double yellow|yellow flag|\byellow\b|incident/.test(raw)) {
    return 76;
  }
  if (/green flag|restart|resumed|safety car in this lap|virtual safety car ending|vsc ending|sc in this lap/.test(raw)) {
    return 58;
  }
  if (/safetycar|\bvsc\b|\bsc\b|\bvirtual safety car\b|\bsafety car\b/.test(raw)) {
    return 74;
  }
  return 42;
};

const getRaceControlHeading = (row: RaceControlMessage) => {
  const raw = getRaceControlRawText(row);

  if (/chequered/.test(raw)) {
    return 'Drapeau à damier';
  }
  if (/\bred flag\b|session stopped/.test(raw)) {
    return 'Drapeau rouge';
  }
  if (/virtual safety car ending|vsc ending/.test(raw)) {
    return 'Fin du VSC';
  }
  if (/safety car in this lap|sc in this lap/.test(raw)) {
    return 'Fin du Safety Car';
  }
  if (/virtual safety car deployed|\bvirtual safety car\b|\bvsc\b/.test(raw)) {
    return 'Virtual Safety Car';
  }
  if (/\bsafety car\b|safetycar|\bsc\b/.test(raw)) {
    return 'Safety Car';
  }
  if (/retired|abandon/.test(raw)) {
    return row.driver_number ? `Abandon · #${row.driver_number}` : 'Abandon';
  }
  if (/has stopped|stopped on track/.test(raw)) {
    return row.driver_number ? `Voiture arrêtée · #${row.driver_number}` : 'Voiture arrêtée';
  }
  if (/disqualified/.test(raw)) {
    return row.driver_number ? `Disqualification · #${row.driver_number}` : 'Disqualification';
  }
  if (/penalty|drive through|stop\/go/.test(raw)) {
    return row.driver_number ? `Pénalité · #${row.driver_number}` : 'Pénalité';
  }
  if (/investigation|noted|summoned/.test(raw)) {
    return row.driver_number ? `Investigation · #${row.driver_number}` : 'Investigation';
  }
  if (/double yellow|yellow flag|\byellow\b/.test(raw)) {
    return 'Drapeau jaune';
  }
  if (/green flag|restart|resumed/.test(raw)) {
    return 'Relance';
  }

  const main = row.flag || row.category || 'Direction de course';
  return row.driver_number ? `${main} · #${row.driver_number}` : String(main);
};

const getTeamShortName = (teamName?: string | null) => {
  const value = String(teamName || '').trim();
  if (!value) {
    return 'n/d';
  }

  return value
    .replace(/^Scuderia\s+/i, '')
    .replace(/\s+Racing$/i, '')
    .replace(/\s+F1 Team$/i, '')
    .replace(/^Aston Martin Aramco /i, 'Aston Martin ')
    .trim();
};

const formatLeaderGapPoints = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return `-${formatValue(value)}`;
};

const filterRowsByWindow = <T extends OpenF1Row>(rows: T[], session: Session | undefined, windowPreset: WindowPreset) => {
  if (windowPreset === 'full' || !session?.date_start) {
    return rows;
  }

  const sessionStart = parseOpenF1Date(session.date_start);
  const lastRowDate = [...rows]
    .reverse()
    .map((row) => (typeof row.date === 'string' ? parseOpenF1Date(row.date) : Number.NaN))
    .find((value) => !Number.isNaN(value));
  const sessionEnd = session.date_end ? parseOpenF1Date(session.date_end) : Date.now();
  const effectiveEnd = Math.min(
    lastRowDate ?? (Number.isNaN(sessionEnd) ? Date.now() : sessionEnd),
    Number.isNaN(sessionEnd) ? Date.now() : sessionEnd,
    Date.now(),
  );
  const lookbackMs = (windowPreset === '5m' ? 5 : 15) * 60 * 1000;
  const threshold = Math.max(sessionStart, effectiveEnd - lookbackMs);

  return rows.filter((row) => {
    const rowDate = typeof row.date === 'string' ? parseOpenF1Date(row.date) : Number.NaN;
    return !Number.isNaN(rowDate) && rowDate >= threshold && rowDate <= effectiveEnd;
  });
};

const smoothNumericSeries = (values: Array<number | null>, radius = 2) =>
  values.map((value, index) => {
    if (value === null) {
      return null;
    }

    const neighbors = values
      .slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))
      .filter((entry): entry is number => entry !== null && Number.isFinite(entry));

    if (!neighbors.length) {
      return value;
    }

    return neighbors.reduce((sum, entry) => sum + entry, 0) / neighbors.length;
  });

const bucketNumericSeries = (values: Array<number | null>, maxPoints: number) => {
  if (values.length <= maxPoints) {
    return values;
  }

  return Array.from({ length: maxPoints }, (_, bucketIndex) => {
    const start = Math.floor((bucketIndex / maxPoints) * values.length);
    const end = Math.max(start + 1, Math.floor(((bucketIndex + 1) / maxPoints) * values.length));
    const bucket = values
      .slice(start, end)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    if (!bucket.length) {
      return null;
    }

    return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
  });
};

function App() {
  const currentYear = getCurrentYear();
  const yearOptions = useMemo(
    () => Array.from({ length: currentYear - 2022 }, (_, index) => currentYear - index),
    [currentYear],
  );

  const [activeTab, setActiveTab] = useState<TabKey>('results');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMeetingKey, setSelectedMeetingKey] = useState<number | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState<number | null>(null);
  const [selectedDriverNumber, setSelectedDriverNumber] = useState<number | null>(null);
  const [hasManualDriverSelection, setHasManualDriverSelection] = useState(false);
  const [windowPreset, setWindowPreset] = useState<WindowPreset>('15m');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const latestMeetingQuery = useEndpointData<Meeting>('meetings', { meeting_key: 'latest' }, true);
  const meetingsQuery = useEndpointData<Meeting>('meetings', { year: selectedYear }, true);
  const seasonSessionsQuery = useEndpointData<Session>('sessions', { year: selectedYear }, true);
  const meetings = useMemo(
    () =>
      [...meetingsQuery.data].sort(
        (left, right) =>
          parseOpenF1Date(String(right.date_start ?? '')) - parseOpenF1Date(String(left.date_start ?? '')),
      ),
    [meetingsQuery.data],
  );

  useEffect(() => {
    if (!meetings.length) {
      return;
    }

    if (selectedMeetingKey && meetings.some((meeting) => meeting.meeting_key === selectedMeetingKey)) {
      return;
    }

    const latest = latestMeetingQuery.data[0];
    const preferred =
      latest && latest.year === selectedYear
        ? meetings.find((meeting) => meeting.meeting_key === latest.meeting_key)
        : meetings[0];

    if (preferred) {
      setSelectedMeetingKey(preferred.meeting_key);
    }
  }, [latestMeetingQuery.data, meetings, selectedMeetingKey, selectedYear]);

  const sessionsQuery = useEndpointData<Session>(
    'sessions',
    selectedMeetingKey ? { meeting_key: selectedMeetingKey } : {},
    Boolean(selectedMeetingKey),
  );
  const sessions = useMemo(
    () =>
      [...sessionsQuery.data].sort(
        (left, right) =>
          parseOpenF1Date(String(left.date_start ?? '')) - parseOpenF1Date(String(right.date_start ?? '')),
      ),
    [sessionsQuery.data],
  );
  const seasonSessions = useMemo(
    () =>
      [...seasonSessionsQuery.data].sort(
        (left, right) =>
          parseOpenF1Date(String(left.date_start ?? '')) - parseOpenF1Date(String(right.date_start ?? '')),
      ),
    [seasonSessionsQuery.data],
  );

  useEffect(() => {
    if (!sessions.length) {
      return;
    }

    if (selectedSessionKey && sessions.some((session) => session.session_key === selectedSessionKey)) {
      return;
    }

    const raceSession =
      [...sessions].reverse().find((session) => isGrandPrixRaceSession(session)) ||
      [...sessions].reverse().find((session) => isRaceSession(session));

    setSelectedSessionKey((raceSession || sessions[sessions.length - 1])?.session_key ?? null);
  }, [selectedSessionKey, sessions]);

  useEffect(() => {
    setSelectedDriverNumber(null);
    setHasManualDriverSelection(false);
  }, [selectedSessionKey]);

  const driversQuery = useEndpointData<Driver>(
    'drivers',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
  );
  const drivers = useMemo(
    () => [...driversQuery.data].sort((left, right) => Number(left.driver_number) - Number(right.driver_number)),
    [driversQuery.data],
  );
  const driverLookup = useMemo(() => new Map(drivers.map((driver) => [driver.driver_number, driver])), [drivers]);

  const selectedMeeting = meetings.find((meeting) => meeting.meeting_key === selectedMeetingKey) ?? latestMeetingQuery.data[0];
  const selectedSession = sessions.find((session) => session.session_key === selectedSessionKey);
  const meetingLookup = useMemo(() => new Map(meetings.map((meeting) => [meeting.meeting_key, meeting])), [meetings]);
  const sessionPhase = getSessionPhase(selectedSession, nowMs);
  const isSessionLive = sessionPhase === 'live';
  const isRaceSessionSelected = isRaceSession(selectedSession);
  const isLiveRaceSession = isSessionLive && Boolean(isRaceSessionSelected);
  const liveRefreshMs = isSessionLive ? LIVE_REFRESH_MS : 0;
  const weatherRefreshMs = isSessionLive ? WEATHER_REFRESH_MS : 0;
  const raceSessionKey = useMemo(() => {
    const raceSession = sessions.find((session) => isGrandPrixRaceSession(session)) || sessions.find((session) => isRaceSession(session));
    return raceSession?.session_key ?? null;
  }, [sessions]);
  const seasonRaceSessions = useMemo(
    () => seasonSessions.filter((session) => isGrandPrixRaceSession(session)),
    [seasonSessions],
  );
  const seasonRaceSessionKeySet = useMemo(
    () => new Set(seasonRaceSessions.map((session) => session.session_key)),
    [seasonRaceSessions],
  );
  const seasonRaceMeetingKeys = useMemo(
    () => Array.from(new Set(seasonRaceSessions.map((session) => session.meeting_key))),
    [seasonRaceSessions],
  );
  const qualifyingSessionKeyByMeeting = useMemo(() => {
    const map = new Map<number, number>();
    seasonSessions.forEach((session) => {
      if (isGrandPrixQualifyingSession(session)) {
        map.set(session.meeting_key, session.session_key);
        return;
      }

      if (!isQualifyingSession(session) || map.has(session.meeting_key)) {
        return;
      }
      map.set(session.meeting_key, session.session_key);
    });
    return map;
  }, [seasonSessions]);
  const startingGridSessionKey = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    if (isRaceSession(selectedSession)) {
      const qualifyingSession =
        sessions.find((session) => isGrandPrixQualifyingSession(session)) ||
        sessions.find((session) => isQualifyingSession(session));
      return qualifyingSession?.session_key ?? selectedSession.session_key;
    }

    return selectedSession.session_key;
  }, [selectedSession, sessions]);
  const championshipSessionKey = raceSessionKey ?? (selectedSession?.session_type?.toLowerCase() === 'race' ? selectedSession.session_key : null);

  const sessionResultQuery = useEndpointData<SessionResult>(
    'session_result',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const startingGridQuery = useEndpointData<StartingGridRow>(
    'starting_grid',
    startingGridSessionKey ? { session_key: startingGridSessionKey } : {},
    Boolean(startingGridSessionKey),
  );
  const lapsQuery = useEndpointData<LapRow>(
    'laps',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const stintsQuery = useEndpointData<StintRow>(
    'stints',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const intervalsQuery = useEndpointData<IntervalRow>(
    'intervals',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const positionQuery = useEndpointData<PositionRow>(
    'position',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
    liveRefreshMs,
  );

  const raceControlQuery = useEndpointData<RaceControlMessage>(
    'race_control',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    (activeTab === 'events' || isRaceSessionSelected) && Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const pitQuery = useEndpointData<PitRow>(
    'pit',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    activeTab === 'events' && Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const overtakesQuery = useEndpointData<OvertakeRow>(
    'overtakes',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    (activeTab === 'events' || isRaceSessionSelected) && Boolean(selectedSessionKey),
    liveRefreshMs,
  );
  const weatherQuery = useEndpointData<WeatherSample>(
    'weather',
    selectedMeetingKey ? { meeting_key: selectedMeetingKey } : {},
    activeTab === 'weather' && Boolean(selectedMeetingKey),
    weatherRefreshMs,
  );
  const championshipDriversQuery = useEndpointData<ChampionshipDriverRow>(
    'championship_drivers',
    championshipSessionKey ? { session_key: championshipSessionKey } : {},
    Boolean(championshipSessionKey),
  );
  const championshipTeamsQuery = useEndpointData<ChampionshipTeamRow>(
    'championship_teams',
    championshipSessionKey ? { session_key: championshipSessionKey } : {},
    Boolean(championshipSessionKey),
  );
  const driverSeasonResultsQuery = useEndpointData<SessionResult>(
    'session_result',
    selectedDriverNumber && seasonRaceMeetingKeys.length
      ? { meeting_key: seasonRaceMeetingKeys, driver_number: selectedDriverNumber }
      : {},
    activeTab === 'driver' && Boolean(selectedDriverNumber && seasonRaceMeetingKeys.length),
  );
  const driverSeasonGridQuery = useEndpointData<StartingGridRow>(
    'starting_grid',
    selectedDriverNumber && seasonRaceMeetingKeys.length
      ? { meeting_key: seasonRaceMeetingKeys, driver_number: selectedDriverNumber }
      : {},
    activeTab === 'driver' && Boolean(selectedDriverNumber && seasonRaceMeetingKeys.length),
  );

  const latestPositionByDriver = useMemo(() => {
    const map = new Map<number, PositionRow>();
    sortByDate(positionQuery.data).forEach((row) => {
      map.set(row.driver_number, row);
    });
    return map;
  }, [positionQuery.data]);

  const latestIntervalByDriver = useMemo(() => {
    const map = new Map<number, IntervalRow>();
    sortByDate(intervalsQuery.data).forEach((row) => {
      map.set(row.driver_number, row);
    });
    return map;
  }, [intervalsQuery.data]);

  const bestLapByDriver = useMemo(() => {
    const map = new Map<number, number>();
    lapsQuery.data.forEach((row) => {
      const lapTime = toNumeric(row.lap_duration);
      if (lapTime === null) {
        return;
      }

      const currentBest = map.get(row.driver_number);
      if (currentBest === undefined || lapTime < currentBest) {
        map.set(row.driver_number, lapTime);
      }
    });
    return map;
  }, [lapsQuery.data]);

  const latestLapByDriver = useMemo(() => {
    const map = new Map<number, number>();
    lapsQuery.data.forEach((row) => {
      const lapNumber = Number(row.lap_number ?? 0);
      if (!lapNumber) {
        return;
      }

      const current = map.get(row.driver_number) ?? 0;
      if (lapNumber > current) {
        map.set(row.driver_number, lapNumber);
      }
    });
    return map;
  }, [lapsQuery.data]);

  const latestStintByDriver = useMemo(() => {
    const sorted = [...stintsQuery.data].sort((left, right) => {
      if (left.driver_number !== right.driver_number) {
        return left.driver_number - right.driver_number;
      }

      return Number(left.stint_number ?? 0) - Number(right.stint_number ?? 0);
    });

    const map = new Map<number, StintRow>();
    sorted.forEach((row) => {
      map.set(row.driver_number, row);
    });
    return map;
  }, [stintsQuery.data]);

  const gridByDriver = useMemo(
    () => new Map(startingGridQuery.data.map((row) => [row.driver_number, Number(row.position ?? 0)])),
    [startingGridQuery.data],
  );

  const classificationEntries = useMemo<ClassificationEntry[]>(() => {
    const rows: SessionResult[] = sessionResultQuery.data.length
      ? [...sessionResultQuery.data]
      : [...latestPositionByDriver.values()].map((row) => ({
          driver_number: row.driver_number,
          position: row.position,
          gap_to_leader: latestIntervalByDriver.get(row.driver_number)?.gap_to_leader,
        }));

    return rows
      .filter((row) => Number(row.driver_number))
      .sort((left, right) => Number(left.position ?? 999) - Number(right.position ?? 999))
      .map((row, index) => {
        const driver = driverLookup.get(row.driver_number);
        const teamName = getTeamName(row.team_name, driver);
        const accent = getTeamColor(teamName, driver);
        const gridPosition = gridByDriver.get(row.driver_number) || null;
        const finalPosition = Number(row.position ?? latestPositionByDriver.get(row.driver_number)?.position ?? index + 1);
        const intervalRow = latestIntervalByDriver.get(row.driver_number);
        const bestLap = bestLapByDriver.get(row.driver_number) ?? null;
        const latestLap = latestLapByDriver.get(row.driver_number) ?? 0;
        const stint = latestStintByDriver.get(row.driver_number);
        const stintStart = Number(stint?.lap_start ?? 0);
        const stintEnd = Number(stint?.lap_end ?? latestLap ?? stintStart);
        const tyreAge = stint ? Math.max(1, stintEnd - stintStart + 1) : null;
        const statusLabel = getStatusLabel(row);
        const leaderTime = finalPosition === 1 ? formatRaceTime(row.duration) : null;
        const gapValue = row.gap_to_leader || intervalRow?.gap_to_leader || intervalRow?.interval || statusLabel || null;
        const showTyre = statusLabel !== 'Non-partant';

        return {
          driverNumber: row.driver_number,
          position: finalPosition,
          gridPosition,
          positionDelta: gridPosition ? gridPosition - finalPosition : null,
          teamName,
          accent,
          gapLabel: finalPosition === 1 ? leaderTime || 'Leader' : statusLabel || formatGapDisplay(gapValue),
          leaderTime,
          bestLap,
          compound: showTyre && stint?.compound ? String(stint.compound) : null,
          tyreAge: showTyre ? tyreAge : null,
          driver,
          interval: intervalRow?.interval,
          gapToLeader: row.gap_to_leader || intervalRow?.gap_to_leader,
        };
      })
      .filter((entry) => Number.isFinite(entry.position));
  }, [
    bestLapByDriver,
    driverLookup,
    gridByDriver,
    latestIntervalByDriver,
    latestLapByDriver,
    latestPositionByDriver,
    latestStintByDriver,
    sessionResultQuery.data,
  ]);
  const currentPositionByDriver = useMemo(
    () => new Map(classificationEntries.map((entry) => [entry.driverNumber, entry.position])),
    [classificationEntries],
  );

  useEffect(() => {
    if (classificationEntries.length) {
      if (
        !selectedDriverNumber ||
        !classificationEntries.some((entry) => entry.driverNumber === selectedDriverNumber) ||
        !hasManualDriverSelection
      ) {
        setSelectedDriverNumber(classificationEntries[0].driverNumber);
      }
      return;
    }

    if (!selectedDriverNumber && drivers.length) {
      setSelectedDriverNumber(drivers[0].driver_number);
    }
  }, [classificationEntries, drivers, hasManualDriverSelection, selectedDriverNumber]);

  const topDrivers = classificationEntries.slice(0, 3);
  const telemetryPrimaryNumber = classificationEntries[0]?.driverNumber ?? drivers[0]?.driver_number ?? null;
  const telemetrySecondaryNumber = classificationEntries[1]?.driverNumber ?? drivers[1]?.driver_number ?? null;
  const telemetryPrimaryDriver = telemetryPrimaryNumber ? driverLookup.get(telemetryPrimaryNumber) : undefined;
  const telemetrySecondaryDriver = telemetrySecondaryNumber ? driverLookup.get(telemetrySecondaryNumber) : undefined;

  const telemetryPrimaryQuery = useEndpointData<CarDataSample>(
    'car_data',
    selectedSessionKey && telemetryPrimaryNumber
      ? { session_key: selectedSessionKey, driver_number: telemetryPrimaryNumber }
      : {},
    activeTab === 'telemetry' && Boolean(selectedSessionKey && telemetryPrimaryNumber),
    liveRefreshMs,
  );
  const telemetrySecondaryQuery = useEndpointData<CarDataSample>(
    'car_data',
    selectedSessionKey && telemetrySecondaryNumber
      ? { session_key: selectedSessionKey, driver_number: telemetrySecondaryNumber }
      : {},
    activeTab === 'telemetry' && Boolean(selectedSessionKey && telemetrySecondaryNumber),
    liveRefreshMs,
  );
  const telemetryLocationQuery = useEndpointData<LocationSample>(
    'location',
    selectedSessionKey && telemetryPrimaryNumber
      ? { session_key: selectedSessionKey, driver_number: telemetryPrimaryNumber }
      : {},
    activeTab === 'telemetry' && Boolean(selectedSessionKey && telemetryPrimaryNumber),
    liveRefreshMs,
  );

  const telemetryLocationRows = downsample(
    filterRowsByWindow(sortByDate(telemetryLocationQuery.data), selectedSession, windowPreset),
    600,
  );
  const telemetryPrimaryWindowRows = filterRowsByWindow(sortByDate(telemetryPrimaryQuery.data), selectedSession, windowPreset);
  const telemetrySecondaryWindowRows = filterRowsByWindow(sortByDate(telemetrySecondaryQuery.data), selectedSession, windowPreset);

  const telemetryPrimaryColor = getTeamColor(undefined, telemetryPrimaryDriver);
  const telemetrySecondaryColorBase = getTeamColor(undefined, telemetrySecondaryDriver);
  const telemetrySecondaryColor =
    telemetrySecondaryColorBase === telemetryPrimaryColor ? '#ffd84d' : telemetrySecondaryColorBase;
  const secondaryDash = telemetrySecondaryColorBase === telemetryPrimaryColor ? '5 4' : undefined;

  const primarySpeed = bucketNumericSeries(smoothNumericSeries(telemetryPrimaryWindowRows.map((row) => toNumeric(row.speed)), 6), 34);
  const secondarySpeed = bucketNumericSeries(smoothNumericSeries(telemetrySecondaryWindowRows.map((row) => toNumeric(row.speed)), 6), 34);
  const primaryThrottle = bucketNumericSeries(smoothNumericSeries(telemetryPrimaryWindowRows.map((row) => toNumeric(row.throttle)), 4), 36);
  const secondaryThrottle = bucketNumericSeries(smoothNumericSeries(telemetrySecondaryWindowRows.map((row) => toNumeric(row.throttle)), 4), 36);
  const primaryBrake = telemetryPrimaryWindowRows.map((row) => toNumeric(row.brake));
  const primaryRpm = telemetryPrimaryWindowRows.map((row) => toNumeric(row.rpm));
  const primaryMaxSpeed = Math.max(...primarySpeed.filter((value): value is number => value !== null), 0);
  const secondaryMaxSpeed = Math.max(...secondarySpeed.filter((value): value is number => value !== null), 0);
  const primaryAvgThrottle = average(primaryThrottle) ?? 0;
  const primaryAvgBrake = average(primaryBrake) ?? 0;
  const primaryAvgRpm = average(primaryRpm) ?? 0;

  const raceControlRows = useMemo<EventFeedItem[]>(
    () =>
      raceControlQuery.data
        .filter((row) => !isNoiseRaceControlMessage(row))
        .map((row, index) => {
          const priority = getRaceControlPriority(row);
          return {
            id: `rc-${index}-${row.date}`,
            date: row.date,
            tone: getEventToneByPriority(priority),
            headline: getRaceControlHeading(row),
            body: safeText(row.message, 'Message non détaillé'),
            priority,
            sourceType: 'race_control',
            driverNumber: row.driver_number ? Number(row.driver_number) : undefined,
            sourceLabel: row.driver_number ? undefined : 'Race Control',
            lapLabel: row.lap_number ? `Tour ${row.lap_number}` : 'Session',
            badge: row.flag || row.category || 'RC',
          };
        }),
    [raceControlQuery.data],
  );

  const pitRows = useMemo<EventFeedItem[]>(
    () =>
      pitQuery.data.flatMap((row, index) => {
        const stop = toNumeric(row.stop_duration);
        const lane = toNumeric(row.lane_duration);
        const currentPosition = currentPositionByDriver.get(row.driver_number) ?? 99;
        const isFocusDriver = selectedDriverNumber === row.driver_number;
        const isSlowStop = (stop ?? 0) >= 4.5;
        const isLongLane = (lane ?? 0) >= 24;
        const isNotable = isFocusDriver || currentPosition <= 5 || isSlowStop || isLongLane;

        if (!isNotable) {
          return [];
        }

        const details = [
          stop !== null && stop < 180 ? `Arrêt ${formatDurationSeconds(stop)}` : null,
          lane !== null && lane < 180 ? `Voie ${formatDurationSeconds(lane)}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const priority = isFocusDriver ? 72 : currentPosition <= 3 ? 68 : isSlowStop || isLongLane ? 62 : 54;

        return [
          {
            id: `pit-${index}-${row.date}-${row.driver_number}`,
            date: row.date,
            tone: getEventToneByPriority(priority),
            headline: isSlowStop ? 'Arrêt lent aux stands' : 'Passage aux stands',
            body: details || 'Passage stand / garage',
            priority,
            sourceType: 'pit',
            driverNumber: row.driver_number,
            lapLabel: row.lap_number ? `Tour ${row.lap_number}` : 'Stand',
            badge: 'Stand',
          },
        ];
      }),
    [currentPositionByDriver, pitQuery.data, selectedDriverNumber],
  );

  const overtakeRows = useMemo<EventFeedItem[]>(
    () => {
      const seen = new Set<string>();

      return sortByDate(overtakesQuery.data).flatMap((row, index) => {
        const attackerNumber = row.overtaking_driver_number ? Number(row.overtaking_driver_number) : null;
        const defenderNumber = row.overtaken_driver_number ? Number(row.overtaken_driver_number) : null;
        const position = Number(row.position ?? 0) || null;
        const minuteBucket = Math.floor(parseOpenF1Date(row.date) / 60000);
        const signature = `${attackerNumber}-${defenderNumber}-${position ?? 'x'}-${minuteBucket}`;

        if (seen.has(signature)) {
          return [];
        }
        seen.add(signature);

        const involvesFocusDriver = attackerNumber === selectedDriverNumber || defenderNumber === selectedDriverNumber;
        const isNotable = involvesFocusDriver || Boolean(position && position <= 10);
        if (!isNotable) {
          return [];
        }

        const attacker = attackerNumber ? driverLookup.get(attackerNumber) : undefined;
        const defender = defenderNumber ? driverLookup.get(defenderNumber) : undefined;
        const attackerCode = attacker ? getDriverCode(attacker) : `#${safeText(row.overtaking_driver_number)}`;
        const defenderCode = defender ? getDriverCode(defender) : `#${safeText(row.overtaken_driver_number)}`;

        let priority = involvesFocusDriver ? 68 : 58;
        let headline = 'Dépassement';
        let badge = 'Piste';

        if (position === 1) {
          priority = 96;
          headline = 'Changement de leader';
          badge = 'P1';
        } else if (position && position <= 3) {
          priority = 82;
          headline = 'Dépassement pour le podium';
          badge = `P${position}`;
        } else if (position && position <= 10) {
          priority = 74;
          headline = 'Dépassement dans les points';
          badge = `P${position}`;
        } else if (involvesFocusDriver) {
          priority = 68;
          headline = 'Duel du pilote suivi';
          badge = 'Focus';
        }

        return [
          {
            id: `ot-${index}-${row.date}`,
            date: row.date,
            tone: getEventToneByPriority(priority),
            headline,
            body: `${attackerCode} passe ${defenderCode}${position ? ` pour P${position}` : ''}`,
            priority,
            sourceType: 'overtake',
            driverNumber: attackerNumber ?? undefined,
            sourceLabel: attackerNumber ? undefined : 'Piste',
            lapLabel: position ? `P${position}` : 'Position',
            badge,
          },
        ];
      });
    },
    [driverLookup, overtakesQuery.data, selectedDriverNumber],
  );

  const eventRows = useMemo<EventFeedItem[]>(
    () =>
      [...raceControlRows, ...pitRows, ...overtakeRows]
        .sort((left, right) => parseOpenF1Date(right.date) - parseOpenF1Date(left.date))
        .slice(0, 20),
    [overtakeRows, pitRows, raceControlRows],
  );
  const featuredEventRows = useMemo<EventFeedItem[]>(
    () =>
      [...eventRows]
        .filter((row) => row.priority >= 70)
        .sort(
          (left, right) =>
            right.priority - left.priority || parseOpenF1Date(right.date) - parseOpenF1Date(left.date),
        )
        .slice(0, 4),
    [eventRows],
  );
  const tickerRows = useMemo<EventFeedItem[]>(() => {
    const highPriority = raceControlRows.filter((row) => row.priority >= 70);
    const candidateRows = highPriority.length ? highPriority : raceControlRows.filter((row) => row.priority >= 58);

    return [...candidateRows]
      .sort((left, right) => parseOpenF1Date(right.date) - parseOpenF1Date(left.date))
      .slice(0, 5);
  }, [raceControlRows]);
  const raceSummary = useMemo(() => {
    const safetyCarDeployments = raceControlQuery.data.filter((row) => {
      const raw = getRaceControlRawText(row);
      return /safety car deployed|sc deployed/.test(raw) && !/virtual|vsc/.test(raw);
    }).length;

    const vscDeployments = raceControlQuery.data.filter((row) => {
      const raw = getRaceControlRawText(row);
      return /virtual safety car deployed|vsc deployed/.test(raw);
    }).length;

    const penaltyCount = raceControlQuery.data.filter((row) => {
      const raw = getRaceControlRawText(row);
      return /penalty|drive through|stop\/go|disqualified/.test(raw);
    }).length;

    const retirementSignatures = new Set<string>();
    raceControlQuery.data.forEach((row) => {
      const raw = getRaceControlRawText(row);
      if (/retired|abandon|has stopped|stopped on track/.test(raw)) {
        retirementSignatures.add(row.driver_number ? `driver-${row.driver_number}` : `${raw}-${row.date}`);
      }
    });
    classificationEntries.forEach((entry) => {
      if (/abandon/i.test(entry.gapLabel)) {
        retirementSignatures.add(`classification-${entry.driverNumber}`);
      }
    });

    const keyOvertakeCount = new Set(
      overtakeRows.filter((row) => row.priority >= 82).map((row) => `${row.headline}-${row.body}`),
    ).size;
    const latestHeadline = featuredEventRows[0] || tickerRows[0] || eventRows[0] || null;
    const stats: RaceSummaryStat[] = [
      {
        label: 'SC',
        value: String(safetyCarDeployments),
        tone: safetyCarDeployments ? 'is-warn' : undefined,
        detail: safetyCarDeployments ? 'Déploiements' : 'Aucun',
      },
      {
        label: 'VSC',
        value: String(vscDeployments),
        tone: vscDeployments ? 'is-warn' : undefined,
        detail: vscDeployments ? 'Déploiements' : 'Aucun',
      },
      {
        label: 'Pénalités',
        value: String(penaltyCount),
        tone: penaltyCount ? 'is-alert' : undefined,
        detail: penaltyCount ? 'Messages officiels' : 'Aucune',
      },
      {
        label: 'Abandons',
        value: String(retirementSignatures.size),
        tone: retirementSignatures.size ? 'is-alert' : undefined,
        detail: retirementSignatures.size ? 'Pilotes touchés' : 'Aucun',
      },
      {
        label: 'Dépassements clés',
        value: String(keyOvertakeCount),
        tone: keyOvertakeCount ? 'is-ok' : undefined,
        detail: keyOvertakeCount ? 'Leader et podium' : 'Aucun',
      },
    ];

    return {
      stats,
      latestHeadline,
      hasData:
        Boolean(raceControlQuery.data.length) ||
        Boolean(overtakesQuery.data.length) ||
        Boolean(featuredEventRows.length) ||
        Boolean(tickerRows.length),
    };
  }, [classificationEntries, eventRows, featuredEventRows, overtakesQuery.data.length, overtakeRows, raceControlQuery.data, tickerRows]);
  const weatherRows = useMemo(() => downsample(sortByDate(weatherQuery.data), 120), [weatherQuery.data]);
  const latestWeather = weatherRows[weatherRows.length - 1];
  const championshipDrivers = useMemo<DriverStandingEntry[]>(
    () => {
      const rows = [...championshipDriversQuery.data]
        .sort((left, right) => Number(left.position_current ?? 999) - Number(right.position_current ?? 999))
        .map((row, index) => {
          const driver = driverLookup.get(Number(row.driver_number));
          const position = Number(row.position_current ?? index + 1);
          const positionStart = Number(row.position_start ?? 0);
          const points = toNumeric(row.points_current) ?? 0;
          const teamName = getTeamName(undefined, driver);
          return {
            driverNumber: Number(row.driver_number),
            position,
            positionDelta: positionStart ? positionStart - position : null,
            points,
            leaderGap: 0,
            driver,
            accent: getTeamColor(undefined, driver),
            teamName,
          };
        });

      const leaderPoints = rows[0]?.points ?? 0;
      return rows.map((row) => ({ ...row, leaderGap: Math.max(0, leaderPoints - row.points) }));
    },
    [championshipDriversQuery.data, driverLookup],
  );
  const championshipTeams = useMemo<TeamStandingEntry[]>(
    () => {
      const hasCompleteEndpointRows = championshipTeamsQuery.data.length && championshipTeamsQuery.data.every((row) => row.team_name);
      if (hasCompleteEndpointRows) {
        const rows = [...championshipTeamsQuery.data]
          .sort((left, right) => Number(left.position_current ?? 999) - Number(right.position_current ?? 999))
          .map((row, index) => {
            const position = Number(row.position_current ?? index + 1);
            const positionStart = Number(row.position_start ?? 0);
            const points = toNumeric(row.points_current) ?? 0;
            const teamName = safeText(row.team_name, 'Équipe');
            return {
              teamName,
              position,
              positionDelta: positionStart ? positionStart - position : null,
              points,
              leaderGap: 0,
              accent: getTeamColor(teamName),
            };
          });

        const leaderPoints = rows[0]?.points ?? 0;
        return rows.map((row) => ({ ...row, leaderGap: Math.max(0, leaderPoints - row.points) }));
      }

      const teamMap = new Map<
        string,
        { teamName: string; points: number; pointsStart: number | null; accent: string }
      >();

      championshipDriversQuery.data.forEach((row) => {
        const driver = driverLookup.get(Number(row.driver_number));
        const teamName = driver?.team_name;
        if (!teamName) {
          return;
        }

        const current = toNumeric(row.points_current) ?? 0;
        const start = toNumeric(row.points_start);
        const existing = teamMap.get(teamName) ?? {
          teamName,
          points: 0,
          pointsStart: 0,
          accent: getTeamColor(teamName, driver),
        };

        existing.points += current;
        existing.pointsStart = (existing.pointsStart ?? 0) + (start ?? 0);
        teamMap.set(teamName, existing);
      });

      const currentRows = [...teamMap.values()].sort((left, right) => right.points - left.points || left.teamName.localeCompare(right.teamName));
      const startRows = [...teamMap.values()].sort(
        (left, right) => (right.pointsStart ?? 0) - (left.pointsStart ?? 0) || left.teamName.localeCompare(right.teamName),
      );
      const startIndex = new Map(startRows.map((row, index) => [row.teamName, index + 1]));
      const hasMeaningfulStartOrder = new Set(startRows.map((row) => row.pointsStart ?? 0)).size > 1;

      return currentRows.map((row, index) => ({
        teamName: row.teamName,
        position: index + 1,
        positionDelta: hasMeaningfulStartOrder ? (startIndex.get(row.teamName) ?? index + 1) - (index + 1) : null,
        points: row.points,
        leaderGap: Math.max(0, (currentRows[0]?.points ?? row.points) - row.points),
        accent: row.accent,
      }));
    },
    [championshipDriversQuery.data, championshipTeamsQuery.data, driverLookup],
  );
  const championshipLoading = championshipDriversQuery.loading || championshipTeamsQuery.loading;
  const championshipError =
    championshipDrivers.length || championshipTeams.length ? null : championshipDriversQuery.error || championshipTeamsQuery.error;
  const driverDirectory = useMemo(
    () =>
      championshipDrivers.length
        ? championshipDrivers
        : drivers
            .map((driver, index) => ({
              driverNumber: driver.driver_number,
              position: index + 1,
              positionDelta: null,
              points: 0,
              leaderGap: 0,
              driver,
              accent: getTeamColor(undefined, driver),
              teamName: getTeamName(undefined, driver),
            }))
            .sort((left, right) => getDriverName(left.driver).localeCompare(getDriverName(right.driver))),
    [championshipDrivers, drivers],
  );
  const selectedDriverStanding = championshipDrivers.find((entry) => entry.driverNumber === selectedDriverNumber) ?? null;
  const seasonResultBySession = useMemo(() => {
    const map = new Map<number, SessionResult>();
    driverSeasonResultsQuery.data.forEach((row) => {
      const sessionKey = Number(row.session_key ?? 0);
      if (!seasonRaceSessionKeySet.has(sessionKey)) {
        return;
      }
      map.set(sessionKey, row);
    });
    return map;
  }, [driverSeasonResultsQuery.data, seasonRaceSessionKeySet]);
  const seasonGridByMeeting = useMemo(() => {
    const fallback = new Map<number, StartingGridRow>();
    const preferred = new Map<number, StartingGridRow>();

    driverSeasonGridQuery.data.forEach((row) => {
      const meetingKey = Number(row.meeting_key ?? 0);
      if (!meetingKey) {
        return;
      }

      if (!fallback.has(meetingKey)) {
        fallback.set(meetingKey, row);
      }

      const preferredSessionKey = qualifyingSessionKeyByMeeting.get(meetingKey);
      if (preferredSessionKey && Number(row.session_key ?? 0) === preferredSessionKey) {
        preferred.set(meetingKey, row);
      }
    });

    return new Map([...fallback.entries(), ...preferred.entries()]);
  }, [driverSeasonGridQuery.data, qualifyingSessionKeyByMeeting]);
  const driverSeasonEntries = useMemo<DriverSeasonRaceEntry[]>(
    () =>
      seasonRaceSessions.map((session) => {
        const meeting = meetingLookup.get(session.meeting_key);
        const result = seasonResultBySession.get(session.session_key);
        const gridRow = seasonGridByMeeting.get(session.meeting_key);
        const statusLabel = getStatusLabel(result);
        const position = result ? Number(result.position ?? 0) || null : null;
        const points = toNumeric(result?.points) ?? 0;
        const sessionState = getSessionPhase(session, nowMs);
        const gapLabel = result
          ? position === 1
            ? formatRaceTime(result.duration)
            : statusLabel || formatGapDisplay(result.gap_to_leader)
          : sessionState === 'upcoming'
            ? 'À venir'
            : sessionState === 'live'
              ? 'En cours'
              : 'n/d';

        return {
          meetingKey: session.meeting_key,
          sessionKey: session.session_key,
          meetingLabel: getMeetingLabel(meeting),
          dateLabel: formatDateLabel(session.date_start || meeting?.date_start),
          locationLabel: safeText(meeting?.circuit_short_name || meeting?.location, 'Circuit n/d'),
          position,
          gridPosition: gridRow ? Number(gridRow.position ?? 0) || null : null,
          points,
          lapsCompleted: result ? Number(result.number_of_laps ?? 0) || null : null,
          statusLabel,
          gapLabel,
          completed: Boolean(result),
        };
      }),
    [meetingLookup, nowMs, seasonGridByMeeting, seasonRaceSessions, seasonResultBySession],
  );
  const completedDriverSeasonEntries = useMemo(
    () => driverSeasonEntries.filter((entry) => entry.completed),
    [driverSeasonEntries],
  );
  const seasonWins = completedDriverSeasonEntries.filter((entry) => entry.position === 1).length;
  const seasonPodiums = completedDriverSeasonEntries.filter((entry) => (entry.position ?? 99) <= 3).length;
  const seasonTopTen = completedDriverSeasonEntries.filter((entry) => (entry.position ?? 99) <= 10).length;
  const seasonAverageFinish = average(completedDriverSeasonEntries.map((entry) => entry.position));
  const seasonAverageGrid = average(completedDriverSeasonEntries.map((entry) => entry.gridPosition));
  const seasonNetGain = completedDriverSeasonEntries.reduce((total, entry) => {
    if (!entry.gridPosition || !entry.position) {
      return total;
    }
    return total + (entry.gridPosition - entry.position);
  }, 0);
  const bestSeasonResult = completedDriverSeasonEntries.reduce<number | null>((best, entry) => {
    if (!entry.position) {
      return best;
    }
    return best === null ? entry.position : Math.min(best, entry.position);
  }, null);
  const recentDriverResults = completedDriverSeasonEntries.slice(-5).reverse();
  const driverSeasonLoading = seasonSessionsQuery.loading || driverSeasonResultsQuery.loading || driverSeasonGridQuery.loading;
  const driverSeasonError =
    driverSeasonResultsQuery.error || driverSeasonGridQuery.error || (seasonRaceSessions.length ? null : seasonSessionsQuery.error);

  useEffect(() => {
    if (!selectedDriverNumber && driverDirectory.length) {
      setSelectedDriverNumber(driverDirectory[0].driverNumber);
    }
  }, [driverDirectory, selectedDriverNumber]);

  const selectedEntry = classificationEntries.find((entry) => entry.driverNumber === selectedDriverNumber);
  const selectedDriver = selectedEntry?.driver || drivers.find((driver) => driver.driver_number === selectedDriverNumber);
  const selectedDriverProfile =
    selectedDriver || selectedDriverStanding?.driver || driverDirectory.find((entry) => entry.driverNumber === selectedDriverNumber)?.driver;
  const aheadEntry = selectedEntry && selectedEntry.position > 1
    ? classificationEntries.find((entry) => entry.position === selectedEntry.position - 1)
    : undefined;
  const liveGap = selectedEntry?.interval || selectedEntry?.gapToLeader || null;
  const handleSelectDriver = (driverNumber: number) => {
    setHasManualDriverSelection(true);
    setSelectedDriverNumber(driverNumber);
  };

  const resultsLoading =
    sessionResultQuery.loading ||
    startingGridQuery.loading ||
    lapsQuery.loading ||
    stintsQuery.loading ||
    intervalsQuery.loading ||
    positionQuery.loading;
  const resultsError =
    sessionResultQuery.error ||
    startingGridQuery.error ||
    lapsQuery.error ||
    stintsQuery.error ||
    intervalsQuery.error ||
    positionQuery.error;

  return (
    <div className="app-shell">
      {isLiveRaceSession ? (
        <section className="live-strip panel" aria-label="Race Control en direct">
          <div className="live-strip-head">
            <strong>Race Control</strong>
            <span>Live · auto-refresh {Math.round(LIVE_REFRESH_MS / 1000)}s</span>
          </div>
          <div className="live-strip-track">
            {tickerRows.length ? (
              tickerRows.map((row) => (
                <article key={row.id} className={`live-chip ${row.tone}`}>
                  <span className="live-chip-badge">{row.badge || 'RC'}</span>
                  <strong>{row.headline}</strong>
                  <span>{row.body}</span>
                  <small>{row.lapLabel || formatDateTime(row.date)}</small>
                </article>
              ))
            ) : (
              <article className="live-chip is-neutral">
                <span className="live-chip-badge">RC</span>
                <strong>Race Control en écoute</strong>
                <span>Aucune alerte prioritaire pour l’instant. Le flux sera mis à jour automatiquement.</span>
                <small>Session live</small>
              </article>
            )}
          </div>
        </section>
      ) : null}

      {isRaceSessionSelected && (raceSummary.hasData || raceControlQuery.loading || overtakesQuery.loading) ? (
        <section className="race-summary panel" aria-label="Résumé course">
          <div className="race-summary-head">
            <div>
              <strong>{isSessionLive ? 'Résumé live' : 'Résumé course'}</strong>
              <p>{isSessionLive ? 'Compte rendu mis à jour automatiquement pendant la course.' : 'Résumé conservé après l’arrivée.'}</p>
            </div>
            <span className={`session-state-pill ${isSessionLive ? 'is-live' : ''}`}>
              {isSessionLive ? 'En direct' : 'Archivé'}
            </span>
          </div>
          <div className="race-summary-grid">
            {raceSummary.stats.map((stat) => (
              <article key={stat.label} className={`race-summary-card ${stat.tone || ''}`}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                <small>{stat.detail || 'n/d'}</small>
              </article>
            ))}
            <article className={`race-summary-card is-headline ${raceSummary.latestHeadline?.tone || ''}`}>
              <span>Dernier fait marquant</span>
              <strong>{raceSummary.latestHeadline?.headline || 'Aucun fait saillant détecté'}</strong>
              <small>
                {raceSummary.latestHeadline
                  ? `${raceSummary.latestHeadline.body} · ${raceSummary.latestHeadline.lapLabel || formatDateTime(raceSummary.latestHeadline.date)}`
                  : 'Le résumé restera visible même après la fin du live.'}
              </small>
            </article>
          </div>
        </section>
      ) : null}

      <div className="broadcast-topbar">
        <div className="brand-block">
          <h1>F1 Center</h1>
          <div className="hero-status-row">
            <span className={`session-state-pill ${isSessionLive ? 'is-live' : ''}`}>{getSessionState(selectedSession, nowMs)}</span>
            {isSessionLive ? <span className="session-state-pill is-refresh">Auto-refresh {Math.round(LIVE_REFRESH_MS / 1000)}s</span> : null}
          </div>
          <p className="hero-subline">
            {getMeetingLabel(selectedMeeting)} · {formatMeetingDateRange(selectedMeeting)} · {getSessionLabel(selectedSession?.session_name)}
          </p>
        </div>
        <div className="hero-meta panel">
          <div className="hero-meta-row">
            <span>Grand Prix</span>
            <strong>{getMeetingLabel(selectedMeeting)}</strong>
          </div>
          <div className="hero-meta-row">
            <span>Dates</span>
            <strong>{formatMeetingDateRange(selectedMeeting)}</strong>
          </div>
          <div className="hero-meta-row">
            <span>Session</span>
            <strong>{getSessionLabel(selectedSession?.session_name)} · {getSessionState(selectedSession, nowMs)}</strong>
          </div>
          <div className="hero-meta-row">
            <span>Lieu / horaire</span>
            <strong>
              {safeText(selectedMeeting?.location, 'Lieu inconnu')} · {getCountryLabel(selectedMeeting?.country_code, selectedMeeting?.country_name)} · {toTimeLabel(selectedSession?.date_start)} → {toTimeLabel(selectedSession?.date_end)}
            </strong>
          </div>
        </div>
      </div>

      <section className="control-rack panel">
        <div className="control-grid">
          <label>
            <span>Saison</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Grand Prix</span>
            <select
              value={selectedMeetingKey ?? ''}
              onChange={(event) => setSelectedMeetingKey(Number(event.target.value) || null)}
            >
              {meetings.map((meeting) => (
                <option key={meeting.meeting_key} value={meeting.meeting_key}>
                  {getMeetingOptionLabel(meeting)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Session</span>
            <select
              value={selectedSessionKey ?? ''}
              onChange={(event) => setSelectedSessionKey(Number(event.target.value) || null)}
            >
              {sessions.map((session) => (
                <option key={session.session_key} value={session.session_key}>
                  {getSessionLabel(session.session_name)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="championship-rack">
        <section className="panel championship-panel">
          <SectionHeading
            title="Championnat pilotes"
            detail="Classement total actualisé après la course du week-end."
            loading={championshipLoading}
          />
          {championshipError ? <ErrorBanner message={championshipError} /> : null}
          {championshipDrivers.length ? (
            <StandingsTable
              variant="drivers"
              drivers={championshipDrivers}
              onSelectDriver={handleSelectDriver}
            />
          ) : (
            <EmptyState
              title="Championnat pilotes indisponible"
              copy="OpenF1 publie ce classement uniquement pour les sessions de course."
              compact
            />
          )}
        </section>
        <section className="panel championship-panel">
          <SectionHeading
            title="Championnat constructeurs"
            detail="Vue rapide des points équipes sur l’ensemble de la saison."
            loading={championshipLoading}
          />
          {championshipError ? <ErrorBanner message={championshipError} /> : null}
          {championshipTeams.length ? (
            <StandingsTable variant="teams" teams={championshipTeams} />
          ) : (
            <EmptyState
              title="Championnat constructeurs indisponible"
              copy="Le classement constructeurs arrive après publication des données course."
              compact
            />
          )}
        </section>
      </section>

      <section className="tab-rack panel">
        <div className="tab-list">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tab-button ${activeTab === tab.key ? 'is-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.detail}</span>
            </button>
          ))}
        </div>
        {activeTab === 'telemetry' ? (
          <div className="window-row">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`window-chip ${windowPreset === option ? 'is-active' : ''}`}
                onClick={() => setWindowPreset(option)}
              >
                {option === 'full' ? 'Session complète' : option === '15m' ? '15 dernières min' : '5 dernières min'}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {activeTab === 'results' && (
        <main className="main-grid">
          <section className="podium-grid">
            {topDrivers.length ? (
              <PodiumStrip entries={topDrivers} onSelect={handleSelectDriver} selectedDriverNumber={selectedDriverNumber} />
            ) : (
              <section className="panel wide-panel">
                <EmptyState
                  title="Aucun podium disponible"
                  copy="Choisis une session avec classement ou données de position publiées."
                />
              </section>
            )}
          </section>

          <section className="classification-shell panel wide-panel">
            <SectionHeading
              title="Classement principal"
              detail="Position, gain/perte, meilleur tour et pneus au premier coup d’œil."
              loading={resultsLoading}
            />
            {resultsError ? <ErrorBanner message={resultsError} /> : null}
            {classificationEntries.length ? (
              <ClassificationTable
                entries={classificationEntries}
                selectedDriverNumber={selectedDriverNumber}
                onSelect={handleSelectDriver}
              />
            ) : (
              <EmptyState
                title="Classement indisponible"
                copy="OpenF1 n’a pas encore publié de résultat ou de positions exploitables pour cette session."
              />
            )}
          </section>

          <aside className="side-column">
            <section className="panel focus-panel">
              <SectionHeading title="Pilote suivi" detail="Clique sur une ligne pour changer le focus." />
              <FocusedDriverCard entry={selectedEntry} driver={selectedDriver} />
            </section>
            <section className="panel gap-panel">
              <SectionHeading title="Gap Tracker" detail="Écart avec la voiture devant." />
              <GapTracker current={selectedEntry} ahead={aheadEntry} gapLabel={liveGap} />
            </section>
          </aside>
        </main>
      )}

      {activeTab === 'driver' && (
        <main className="driver-season-layout">
          <aside className="panel driver-directory-panel">
            <SectionHeading
              title="Pilotes"
              detail="Classement saison. Clique sur un pilote pour ouvrir sa fiche complète."
              loading={championshipLoading && !driverDirectory.length}
            />
            {championshipError && !driverDirectory.length ? <ErrorBanner message={championshipError} /> : null}
            {driverDirectory.length ? (
              <div className="driver-directory-list">
                {driverDirectory.map((entry) => (
                  <button
                    key={entry.driverNumber}
                    type="button"
                    className={`driver-directory-row ${selectedDriverNumber === entry.driverNumber ? 'is-selected' : ''}`}
                    style={{ '--team-accent': entry.accent } as CSSProperties}
                    onClick={() => handleSelectDriver(entry.driverNumber)}
                  >
                    <strong>P{entry.position}</strong>
                    <DriverChip driver={entry.driver} accent={entry.accent} compact />
                    <div className="driver-directory-meta">
                      <span>{getTeamShortName(entry.teamName)}</span>
                      <strong>{formatValue(entry.points)} pts</strong>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Liste pilotes indisponible"
                copy="Le classement championnat fournira automatiquement la liste dès qu’une course est publiée."
                compact
              />
            )}
          </aside>

          <section className="driver-season-main">
            <section className="panel driver-season-hero">
              <SectionHeading
                title="Fiche pilote"
                detail={`Saison ${selectedYear} · points championnat et résultats course par course.`}
                loading={driverSeasonLoading}
              />
              {driverSeasonError ? <ErrorBanner message={driverSeasonError} /> : null}
              {selectedDriverNumber && selectedDriverProfile ? (
                <>
                  <div
                    className="driver-season-profile"
                    style={{ '--team-accent': getTeamColor(undefined, selectedDriverProfile) } as CSSProperties}
                  >
                    <Avatar driver={selectedDriverProfile} size="hero" accent={getTeamColor(undefined, selectedDriverProfile)} />
                    <div className="driver-season-profile-copy">
                      <p className="kicker">Pilote</p>
                      <h3>{getDriverName(selectedDriverProfile)}</h3>
                      <div className="driver-season-profile-badges">
                        <span className="team-badge">{getTeamName(undefined, selectedDriverProfile)}</span>
                        <span className="team-badge">#{selectedDriverProfile.driver_number}</span>
                        {selectedDriverStanding ? <span className="team-badge">Championnat P{selectedDriverStanding.position}</span> : null}
                      </div>
                      <div className="season-form-row">
                        {recentDriverResults.length ? (
                          recentDriverResults.map((entry) => (
                            <span
                              key={`${entry.sessionKey}-${entry.position ?? entry.gapLabel}`}
                              className={`season-form-chip ${entry.statusLabel ? 'is-alert' : entry.position === 1 ? 'is-win' : ''}`}
                              title={`${entry.meetingLabel} · ${entry.gapLabel}`}
                            >
                              {entry.statusLabel ? entry.statusLabel.slice(0, 3).toUpperCase() : `P${entry.position}`}
                            </span>
                          ))
                        ) : (
                          <span className="muted">Aucun résultat course publié pour l’instant.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="metric-grid driver-season-metrics">
                    <MetricCard label="Points championnat" value={`${formatValue(selectedDriverStanding?.points ?? completedDriverSeasonEntries.reduce((sum, entry) => sum + entry.points, 0))}`} />
                    <MetricCard label="Écart au leader" value={formatLeaderGapPoints(selectedDriverStanding?.leaderGap ?? 0)} />
                    <MetricCard label="Victoires" value={String(seasonWins)} />
                    <MetricCard label="Podiums" value={String(seasonPodiums)} />
                    <MetricCard label="Top 10" value={String(seasonTopTen)} />
                    <MetricCard label="Meilleure arrivée" value={bestSeasonResult ? `P${bestSeasonResult}` : 'n/d'} />
                    <MetricCard label="Moy. départ" value={seasonAverageGrid ? `P${seasonAverageGrid.toFixed(1)}` : 'n/d'} />
                    <MetricCard label="Moy. arrivée" value={seasonAverageFinish ? `P${seasonAverageFinish.toFixed(1)}` : 'n/d'} />
                    <MetricCard label="Gain net" value={seasonNetGain > 0 ? `+${seasonNetGain}` : String(seasonNetGain)} />
                    <MetricCard label="Courses avec résultat" value={String(completedDriverSeasonEntries.length)} />
                  </div>
                </>
              ) : (
                <EmptyState title="Aucun pilote sélectionné" copy="Choisis un pilote dans la liste de gauche pour afficher sa saison." />
              )}
            </section>

            <section className="panel driver-season-results">
              <SectionHeading
                title="Résultats de la saison"
                detail="Courses uniquement. Le total championnat inclut aussi les points de sprint quand OpenF1 les publie."
                loading={driverSeasonLoading}
              />
              {driverSeasonError ? <ErrorBanner message={driverSeasonError} /> : null}
              {driverSeasonEntries.length ? (
                <DriverSeasonTable entries={driverSeasonEntries} />
              ) : (
                <EmptyState
                  title="Saison pilote indisponible"
                  copy="Aucune course trouvée pour cette saison ou aucun résultat publié pour ce pilote."
                />
              )}
            </section>
          </section>
        </main>
      )}

      {activeTab === 'telemetry' && (
        <main className="tab-grid">
          <section className="panel telemetry-lead">
            <SectionHeading
              title="Duel des leaders"
              detail="Les deux premiers du classement, avec séries lissées pour une lecture plus nette."
              loading={telemetryPrimaryQuery.loading || telemetrySecondaryQuery.loading}
            />
            <div className="compare-head">
              <DriverChip driver={telemetryPrimaryDriver} accent={getTeamColor(undefined, telemetryPrimaryDriver)} compact />
              <span>vs</span>
              <DriverChip driver={telemetrySecondaryDriver} accent={getTeamColor(undefined, telemetrySecondaryDriver)} compact />
            </div>
            <div className="metric-grid telemetry-metrics">
              <MetricCard label={getDriverCode(telemetryPrimaryDriver)} value={`${Math.round(primaryMaxSpeed)} km/h`} />
              <MetricCard label={getDriverCode(telemetrySecondaryDriver)} value={`${Math.round(secondaryMaxSpeed)} km/h`} />
              <MetricCard label="Accélérateur moyen" value={`${Math.round(primaryAvgThrottle)} %`} />
              <MetricCard label="Frein moyen" value={`${Math.round(primaryAvgBrake)} %`} />
              <MetricCard label="RPM moyen" value={compactNumber(primaryAvgRpm)} />
            </div>
          </section>

          <section className="panel">
            <SectionHeading title="Courbe de vitesse" detail="Comparaison directe des vitesses." />
            {primarySpeed.length || secondarySpeed.length ? (
              <LinePlot
                series={[
                  {
                    label: getDriverCode(telemetryPrimaryDriver),
                    color: telemetryPrimaryColor,
                    values: primarySpeed,
                    strokeWidth: 2,
                  },
                  {
                    label: getDriverCode(telemetrySecondaryDriver),
                    color: telemetrySecondaryColor,
                    values: secondarySpeed,
                    dashArray: secondaryDash,
                    strokeWidth: 1.8,
                    opacity: 0.86,
                  },
                ]}
              />
            ) : (
              <EmptyState title="Pas de télémétrie" copy="Cette fenêtre ne renvoie pas encore de données exploitables." compact />
            )}
          </section>

          <section className="panel">
            <SectionHeading title="Accélérateur" detail="Lecture des commandes des deux leaders." />
            {primaryThrottle.length || secondaryThrottle.length ? (
              <LinePlot
                series={[
                  {
                    label: `${getDriverCode(telemetryPrimaryDriver)} throttle`,
                    color: telemetryPrimaryColor,
                    values: primaryThrottle,
                    strokeWidth: 2,
                  },
                  {
                    label: `${getDriverCode(telemetrySecondaryDriver)} throttle`,
                    color: telemetrySecondaryColor,
                    values: secondaryThrottle,
                    dashArray: secondaryDash,
                    strokeWidth: 1.8,
                    opacity: 0.86,
                  },
                ]}
              />
            ) : (
              <EmptyState title="Aucune commande pilote" copy="Change de session ou élargis la fenêtre temporelle." compact />
            )}
          </section>

          <section className="panel">
            <SectionHeading title="Trace du leader" detail="Position XY approximative sur le circuit." loading={telemetryLocationQuery.loading} />
            {telemetryLocationRows.length ? (
              <TrackMap rows={telemetryLocationRows} accent={getTeamColor(undefined, telemetryPrimaryDriver)} />
            ) : (
              <EmptyState title="Aucune trace" copy="Les coordonnées OpenF1 peuvent être absentes sur certaines sessions." compact />
            )}
          </section>
        </main>
      )}

      {activeTab === 'events' && (
        <main className="tab-grid events-grid">
          {featuredEventRows.length ? (
            <section className="event-highlight-row">
              {featuredEventRows.map((row) => (
                <article key={`featured-${row.id}`} className={`panel event-highlight ${row.tone}`}>
                  <span className="event-highlight-badge">{row.badge || row.sourceLabel || 'Live'}</span>
                  <strong>{row.headline}</strong>
                  <p>{row.body}</p>
                  <small>{row.lapLabel || formatDateTime(row.date)}</small>
                </article>
              ))}
            </section>
          ) : null}
          <section className="panel wide-panel">
            <SectionHeading
              title="Événements de course"
              detail="Timeline filtrée: safety car, abandons, pénalités, stands utiles et dépassements marquants."
              loading={raceControlQuery.loading || pitQuery.loading || overtakesQuery.loading}
            />
            {raceControlQuery.error || pitQuery.error || overtakesQuery.error ? (
              <ErrorBanner message={raceControlQuery.error || pitQuery.error || overtakesQuery.error || 'Requête impossible'} />
            ) : null}
            {eventRows.length ? (
              <div className="event-feed">
                {eventRows.map((row, index) => {
                  const driver = row.driverNumber ? driverLookup.get(Number(row.driverNumber)) : undefined;
                  return (
                    <article key={`${row.id}-${index}`} className={`event-row ${row.tone}`}>
                      <div className="event-source-stack">
                        <span className="event-badge">{row.badge || row.sourceLabel || 'Live'}</span>
                        {driver ? (
                          <DriverChip driver={driver} accent={getTeamColor(undefined, driver)} compact />
                        ) : (
                          <span className="event-source">{row.sourceLabel || 'Session'}</span>
                        )}
                      </div>
                      <div className="event-copy">
                        <strong>{row.headline}</strong>
                        <p>{row.body}</p>
                      </div>
                      <div className="event-meta">
                        <strong>{formatDateTime(row.date)}</strong>
                        <span>{row.lapLabel || 'Session'}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Pas d’événement" copy="Aucun message, passage stand ou dépassement exploitable sur cette session." />
            )}
          </section>
        </main>
      )}

      {activeTab === 'weather' && (
        <main className="tab-grid weather-grid">
          <section className="panel weather-head">
            <SectionHeading title="Conditions de piste" detail="Température piste vs air sur l’ensemble du week-end." loading={weatherQuery.loading} />
            <div className="metric-grid">
              <MetricCard label="Piste" value={`${formatValue(latestWeather?.track_temperature)} C`} />
              <MetricCard label="Air" value={`${formatValue(latestWeather?.air_temperature)} C`} />
              <MetricCard label="Humidité" value={`${formatValue(latestWeather?.humidity)} %`} />
              <MetricCard label="Vent" value={`${formatValue(latestWeather?.wind_speed)} m/s`} />
            </div>
          </section>

          <section className="panel wide-panel">
            <SectionHeading title="Évolution météo" detail="Lecture simplifiée des températures pendant le meeting." />
            {weatherRows.length ? (
              <LinePlot
                series={[
                  {
                    label: 'Température piste',
                    color: '#FF3333',
                    values: weatherRows.map((row) => toNumeric(row.track_temperature)),
                  },
                  {
                    label: 'Température air',
                    color: '#27F4D2',
                    values: weatherRows.map((row) => toNumeric(row.air_temperature)),
                  },
                ]}
              />
            ) : (
              <EmptyState title="Pas de météo" copy="La météo OpenF1 est parfois vide selon le Grand Prix ou le timing de publication." />
            )}
          </section>
        </main>
      )}

      <footer className="status-strip">
        <span>{getMeetingLabel(selectedMeeting)} · {getSessionLabel(selectedSession?.session_name)}</span>
        <span>
          {meetingsQuery.error ||
            sessionsQuery.error ||
            driversQuery.error ||
            (isSessionLive
              ? `Live auto-refresh ${Math.round(LIVE_REFRESH_MS / 1000)}s · ${INTEGRATED_ENDPOINT_KEYS.length} endpoints OpenF1 intégrés`
              : `${INTEGRATED_ENDPOINT_KEYS.length} endpoints OpenF1 intégrés`)}
        </span>
      </footer>
    </div>
  );
}

function SectionHeading({ title, detail, loading }: { title: string; detail?: string; loading?: boolean }) {
  return (
    <div className="section-heading">
      <div>
        <h3>{title}</h3>
        {detail ? <p>{detail}</p> : null}
      </div>
      {loading ? <span className="loading-pill">Chargement</span> : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StandingsTable({
  variant,
  drivers = [],
  teams = [],
  onSelectDriver,
}: {
  variant: 'drivers' | 'teams';
  drivers?: DriverStandingEntry[];
  teams?: TeamStandingEntry[];
  onSelectDriver?: (driverNumber: number) => void;
}) {
  const rows = variant === 'drivers' ? drivers : teams;

  return (
    <div className={`standings-table is-${variant}`}>
      <div className="standings-head">
        <span>Pos</span>
        <span>+/-</span>
        <span>{variant === 'drivers' ? 'Pilote' : 'Équipe'}</span>
        <span>Pts</span>
        <span>Écart 1er</span>
      </div>
      <div className="standings-body">
        {variant === 'drivers'
          ? drivers.map((row) => (
              <button
                key={row.driverNumber}
                type="button"
                className="standing-row"
                style={{ '--team-accent': row.accent } as CSSProperties}
                onClick={() => onSelectDriver?.(row.driverNumber)}
              >
                <strong>P{row.position}</strong>
                <PositionDelta value={row.positionDelta} />
                <div className="standing-main">
                  <DriverChip driver={row.driver} accent={row.accent} compact />
                  <span className="standing-sub">{getTeamShortName(row.teamName)}</span>
                </div>
                <strong>{formatValue(row.points)}</strong>
                <span className="standing-points-delta">{formatLeaderGapPoints(row.leaderGap)}</span>
              </button>
            ))
          : teams.map((row) => (
              <div key={`${row.position}-${row.teamName}-${row.points}`} className="standing-row" style={{ '--team-accent': row.accent } as CSSProperties}>
                <strong>P{row.position}</strong>
                <PositionDelta value={row.positionDelta} />
                <div className="standing-main is-team">
                  <span className="chip-accent" />
                  <div className="standing-team-copy">
                    <strong>{getTeamShortName(row.teamName)}</strong>
                    <span>{safeText(row.teamName)}</span>
                  </div>
                </div>
                <strong>{formatValue(row.points)}</strong>
                <span className="standing-points-delta">{formatLeaderGapPoints(row.leaderGap)}</span>
              </div>
            ))}
      </div>
    </div>
  );
}

function DriverSeasonTable({ entries }: { entries: DriverSeasonRaceEntry[] }) {
  return (
    <div className="driver-season-table">
      <div className="driver-season-head">
        <span>Date</span>
        <span>Grand Prix</span>
        <span>Résultat</span>
        <span>Grille</span>
        <span>Pts</span>
        <span>Écart / statut</span>
        <span>Tours</span>
      </div>
      <div className="driver-season-body">
        {entries.map((entry) => (
          <article
            key={`${entry.sessionKey}-${entry.meetingKey}`}
            className={`driver-season-row ${entry.statusLabel ? 'is-alert' : ''} ${entry.completed ? '' : 'is-muted'}`}
          >
            <strong className="driver-season-date" data-label="Date">{entry.dateLabel}</strong>
            <div className="driver-season-meeting">
              <strong>{entry.meetingLabel}</strong>
              <span>{entry.locationLabel}</span>
            </div>
            <strong className="driver-season-result" data-label="Résultat">
              {entry.statusLabel ? entry.statusLabel : entry.position ? `P${entry.position}` : 'n/d'}
            </strong>
            <span className="driver-season-grid" data-label="Grille">{entry.gridPosition ? `P${entry.gridPosition}` : 'n/d'}</span>
            <strong className="driver-season-points" data-label="Pts">{formatValue(entry.points)}</strong>
            <span className="driver-season-gap" data-label="Écart / statut">{entry.gapLabel}</span>
            <span className="driver-season-laps" data-label="Tours">{entry.lapsCompleted ? `${entry.lapsCompleted}` : 'n/d'}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function PodiumStrip({
  entries,
  selectedDriverNumber,
  onSelect,
}: {
  entries: ClassificationEntry[];
  selectedDriverNumber: number | null;
  onSelect: (driverNumber: number) => void;
}) {
  const ordered = entries.slice(0, 3);

  return (
    <>
      {ordered.map((entry) => (
        <button
          key={entry.driverNumber}
          type="button"
          className={`panel podium-card ${entry.position === 1 ? 'is-winner' : ''} ${selectedDriverNumber === entry.driverNumber ? 'is-selected' : ''}`}
          style={{ '--team-accent': entry.accent } as CSSProperties}
          onClick={() => onSelect(entry.driverNumber)}
        >
          <div className="podium-topline">
            <span>P{entry.position}</span>
            <strong>{entry.position === 1 ? entry.leaderTime || 'Leader' : entry.gapLabel}</strong>
          </div>
          <div className="podium-number">#{entry.driverNumber}</div>
          <div className="podium-media">
            <Avatar driver={entry.driver} size="hero" accent={entry.accent} />
          </div>
          <div className="podium-copy">
            <div>
              <p>{getDriverCode(entry.driver)}</p>
              <h3>{getDriverName(entry.driver)}</h3>
            </div>
            <span className="team-badge">{entry.teamName}</span>
          </div>
        </button>
      ))}
    </>
  );
}

function ClassificationTable({
  entries,
  selectedDriverNumber,
  onSelect,
}: {
  entries: ClassificationEntry[];
  selectedDriverNumber: number | null;
  onSelect: (driverNumber: number) => void;
}) {
  return (
    <div className="classification-table">
      <div className="classification-head">
        <span>Pos</span>
        <span>+/-</span>
        <span>Pilote</span>
        <span>Équipe</span>
        <span>Écart / temps</span>
        <span>Grille</span>
        <span>Meilleur tour</span>
        <span>Pneus</span>
      </div>
      <div className="classification-body">
        {entries.map((entry) => (
          <button
            key={entry.driverNumber}
            type="button"
            className={`classification-row ${selectedDriverNumber === entry.driverNumber ? 'is-selected' : ''}`}
            style={{ '--team-accent': entry.accent } as CSSProperties}
            onClick={() => onSelect(entry.driverNumber)}
          >
            <div className="position-cell">
              <strong>{entry.position}</strong>
            </div>
            <div className="delta-cell">
              <PositionDelta value={entry.positionDelta} />
            </div>
            <div className="driver-cell">
              <DriverChip driver={entry.driver} accent={entry.accent} />
            </div>
            <div className="team-cell">
              <span className="team-pill">{entry.teamName}</span>
            </div>
            <div className="gap-cell">
              <strong>{entry.position === 1 ? entry.leaderTime || 'Leader' : entry.gapLabel}</strong>
            </div>
            <div className="grid-cell">
              <strong>{entry.gridPosition ? `P${entry.gridPosition}` : 'n/d'}</strong>
            </div>
            <div className="lap-cell">
              <strong>{entry.bestLap !== null ? formatDurationSeconds(entry.bestLap) : 'n/d'}</strong>
            </div>
            <div className="tyre-cell">
              <TyreBadge compound={entry.compound} age={entry.tyreAge} compact />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DriverChip({
  driver,
  accent,
  compact = false,
}: {
  driver: Driver | undefined;
  accent: string;
  compact?: boolean;
}) {
  return (
    <div className={`driver-chip ${compact ? 'is-compact' : ''}`} style={{ '--team-accent': accent } as CSSProperties}>
      <span className="chip-accent" />
      <Avatar driver={driver} size={compact ? 'sm' : 'md'} accent={accent} />
      <div className="driver-chip-copy">
        <strong>{getDriverCode(driver)}</strong>
        <span>{getDriverName(driver)}</span>
      </div>
    </div>
  );
}

function Avatar({ driver, size, accent }: { driver: Driver | undefined; size: 'sm' | 'md' | 'hero'; accent: string }) {
  const className = `driver-avatar ${size}`;
  const label = getDriverCode(driver);

  if (driver?.headshot_url) {
    return <img className={className} src={driver.headshot_url} alt={getDriverName(driver)} />;
  }

  return (
    <div className={className} style={{ '--team-accent': accent } as CSSProperties}>
      {label}
    </div>
  );
}

function PositionDelta({ value }: { value: number | null }) {
  if (value === null || Number.isNaN(value)) {
    return <span className="delta-flat">--</span>;
  }

  if (value > 0) {
    return <span className="delta-up">▲ {value}</span>;
  }

  if (value < 0) {
    return <span className="delta-down">▼ {Math.abs(value)}</span>;
  }

  return <span className="delta-flat">--</span>;
}

function TyreBadge({ compound, age, compact = false }: { compound: string | null; age: number | null; compact?: boolean }) {
  const meta = TYRE_META[String(compound || '').toUpperCase()] || null;

  if (!meta) {
    return <span className="tyre-empty">n/d</span>;
  }

  return (
    <div className={`tyre-pill ${compact ? 'is-compact' : ''}`}>
      <span className="tyre-dot" style={{ background: meta.color, borderColor: meta.ring || meta.color }} />
      <strong>{compact ? getTyreShortLabel(compound) : meta.label}</strong>
      <small>{formatTyreAgeShort(age)}</small>
    </div>
  );
}

function FocusedDriverCard({ entry, driver }: { entry: ClassificationEntry | undefined; driver: Driver | undefined }) {
  if (!entry || !driver) {
    return <EmptyState title="Aucun pilote sélectionné" copy="Le classement définira automatiquement le pilote suivi." compact />;
  }

  return (
    <div className="focus-driver" style={{ '--team-accent': entry.accent } as CSSProperties}>
      <div className="focus-driver-top">
        <Avatar driver={driver} size="hero" accent={entry.accent} />
        <div>
          <p className="kicker">Pilote en focus</p>
          <h4>{getDriverName(driver)}</h4>
          <span className="team-badge">{entry.teamName}</span>
        </div>
      </div>
      <div className="focus-stats">
        <MetricCard label="Arrivée" value={`P${entry.position}`} />
        <MetricCard label="Départ" value={entry.gridPosition ? `P${entry.gridPosition}` : 'n/d'} />
        <MetricCard label="Meilleur tour" value={entry.bestLap !== null ? formatDurationSeconds(entry.bestLap) : 'n/d'} />
        <MetricCard label="Pneus" value={entry.compound ? `${getTyreLabel(entry.compound)} · ${formatTyreAgeShort(entry.tyreAge)}` : 'n/d'} />
      </div>
    </div>
  );
}

function GapTracker({
  current,
  ahead,
  gapLabel,
}: {
  current: ClassificationEntry | undefined;
  ahead: ClassificationEntry | undefined;
  gapLabel: string | null;
}) {
  if (!current) {
    return <EmptyState title="Aucun écart" copy="Sélectionne une ligne dans le classement principal." compact />;
  }

  if (current.position === 1) {
    return (
      <div className="gap-card leader-gap">
        <strong>Air propre</strong>
        <p>{getDriverCode(current.driver)} mène la session.</p>
      </div>
    );
  }

  const gapSeconds = parseGapSeconds(gapLabel || current.interval || current.gapToLeader);
  const width = gapSeconds === null ? 12 : Math.max(12, 100 - Math.min(gapSeconds, 5) * 18);
  const drsActive = gapSeconds !== null && gapSeconds < 1;

  return (
    <div className="gap-card">
      <div className="gap-copy">
        <span>Voiture devant</span>
        <strong>{ahead ? getDriverName(ahead.driver) : 'n/d'}</strong>
      </div>
      <div className="gap-track">
        <div className="gap-fill" style={{ width: `${width}%`, background: current.accent }} />
      </div>
      <div className="gap-copy">
        <span>Intervalle</span>
        <strong>{formatGapDisplay(gapLabel || current.interval || current.gapToLeader)}</strong>
      </div>
      <div className={`drs-pill ${drsActive ? 'is-live' : ''}`}>{drsActive ? 'DRS ouvert' : 'Hors zone DRS'}</div>
    </div>
  );
}

function LinePlot({ series, reverse = false }: { series: PlotSeries[]; reverse?: boolean }) {
  const validSeries = series.filter((entry) => entry.values.some((value) => value !== null));

  if (!validSeries.length) {
    return <EmptyState title="Aucune valeur exploitable" copy="La requête renvoie des lignes, mais pas de valeurs numériques lisibles ici." compact />;
  }

  const values = validSeries.flatMap((entry) => entry.values.filter((value): value is number => value !== null));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const maxLength = Math.max(...validSeries.map((entry) => entry.values.length));

  const buildPath = (points: Array<number | null>) => {
    let path = '';

    points.forEach((value, index) => {
      if (value === null) {
        return;
      }

      const x = maxLength <= 1 ? 6 : 6 + (index / (maxLength - 1)) * 88;
      const normalized = (value - min) / range;
      const y = reverse ? 8 + normalized * 84 : 92 - normalized * 84;
      path += `${path ? ' L ' : 'M '}${x.toFixed(2)} ${y.toFixed(2)}`;
    });

    return path;
  };

  return (
    <div className="plot-shell">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="plot-svg">
        <rect x="0" y="0" width="100" height="100" rx="8" />
        {[18, 36, 54, 72, 90].map((line) => (
          <line key={line} x1="0" y1={line} x2="100" y2={line} />
        ))}
        {validSeries.map((entry) => (
          <path
            key={entry.label}
            d={buildPath(entry.values)}
            style={{
              stroke: entry.color,
              strokeDasharray: entry.dashArray,
              strokeWidth: entry.strokeWidth ?? 2.4,
              opacity: entry.opacity ?? 1,
            }}
          />
        ))}
      </svg>
      <div className="legend-row">
        {validSeries.map((entry) => (
          <span key={entry.label}>
            <i style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
      <div className="plot-axis">
        <span>{formatValue(reverse ? max : min)}</span>
        <span>{formatValue(reverse ? min : max)}</span>
      </div>
    </div>
  );
}

function TrackMap({ rows, accent }: { rows: LocationSample[]; accent: string }) {
  const points = rows
    .map((row) => ({ x: toNumeric(row.x), y: toNumeric(row.y) }))
    .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null);

  if (!points.length) {
    return <EmptyState title="Aucune coordonnée" copy="Les positions XY OpenF1 ne sont pas disponibles sur cette sélection." compact />;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;

  const path = points
    .map((point, index) => {
      const x = 8 + ((point.x - minX) / width) * 84;
      const y = 92 - ((point.y - minY) / height) * 84;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div className="track-shell">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="track-svg">
        <rect x="0" y="0" width="100" height="100" rx="8" />
        <path d={path} style={{ stroke: accent }} />
      </svg>
      <p className="muted">Coordonnées OpenF1 approximatives pour la fenêtre sélectionnée.</p>
    </div>
  );
}

function EmptyState({ title, copy, compact = false }: { title: string; copy: string; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner">{message}</div>;
}

export default App;
