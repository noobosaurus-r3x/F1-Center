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

type TabKey = 'results' | 'weather' | 'telemetry' | 'events';
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
}

interface StartingGridRow extends OpenF1Row {
  driver_number: number;
  position?: number;
  lap_duration?: number;
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
  driverNumber?: number;
  sourceLabel?: string;
  lapLabel?: string;
}

interface DriverStandingEntry {
  driverNumber: number;
  position: number;
  positionDelta: number | null;
  points: number;
  pointsDelta: number | null;
  driver: Driver | undefined;
  accent: string;
  teamName: string;
}

interface TeamStandingEntry {
  teamName: string;
  position: number;
  positionDelta: number | null;
  points: number;
  pointsDelta: number | null;
  accent: string;
}

const TABS: Array<{ key: TabKey; label: string; detail: string }> = [
  { key: 'results', label: 'Résultats', detail: 'Podium, classement et écarts.' },
  { key: 'weather', label: 'Météo', detail: 'Température et conditions de piste.' },
  { key: 'telemetry', label: 'Télémétrie', detail: 'Comparaison des leaders.' },
  { key: 'events', label: 'Événements', detail: 'Course, stands, drapeaux et dépassements.' },
];

const WINDOW_OPTIONS: WindowPreset[] = ['full', '15m', '5m'];
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
): QueryState<T> {
  const url = useMemo(() => (enabled ? buildEndpointUrl(path, params) : ''), [enabled, params, path]);
  const [state, setState] = useState<QueryState<T>>({ data: [], loading: false, error: null, url });

  useEffect(() => {
    if (!enabled || !url) {
      setState({ data: [], loading: false, error: null, url: '' });
      return;
    }

    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null, url }));

    fetchOpenF1<T>(url)
      .then((data) => {
        if (!cancelled) {
          setState({ data, loading: false, error: null, url });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: [],
            loading: false,
            error: error instanceof Error ? error.message : 'Requête impossible',
            url,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

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

const getSessionState = (session: Session | undefined) => {
  if (!session?.date_start || !session?.date_end) {
    return 'Contexte chargé';
  }

  const now = Date.now();
  const start = parseOpenF1Date(session.date_start);
  const end = parseOpenF1Date(session.date_end);

  if (now < start) {
    return 'Session à venir';
  }

  if (now > end) {
    return 'Session terminée';
  }

  return 'Session en cours';
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

const getEventTone = (row: RaceControlMessage) => {
  const raw = `${row.flag || ''} ${row.category || ''} ${row.message || ''}`.toLowerCase();
  if (/red|black|danger|abandon|unsafe/.test(raw)) {
    return 'is-alert';
  }
  if (/yellow|safety|investigation|incident|track limits/.test(raw)) {
    return 'is-warn';
  }
  if (/green|clear|drs enabled/.test(raw)) {
    return 'is-ok';
  }
  return 'is-neutral';
};

const getEventHeading = (row: RaceControlMessage) => {
  const main = row.flag || row.category || 'Direction de course';
  return row.driver_number ? `${main} · #${row.driver_number}` : String(main);
};

const isMinorRaceControlMessage = (row: RaceControlMessage) => {
  const raw = `${row.flag || ''} ${row.category || ''} ${row.message || ''}`.toLowerCase();
  return /blue/.test(raw) || /clear in track sector/.test(raw) || /all pass holders/.test(raw);
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

  const latestMeetingQuery = useEndpointData<Meeting>('meetings', { meeting_key: 'latest' }, true);
  const meetingsQuery = useEndpointData<Meeting>('meetings', { year: selectedYear }, true);
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

  useEffect(() => {
    if (!sessions.length) {
      return;
    }

    if (selectedSessionKey && sessions.some((session) => session.session_key === selectedSessionKey)) {
      return;
    }

    const raceSession = [...sessions]
      .reverse()
      .find((session) => session.session_type?.toLowerCase() === 'race' || session.session_name?.toLowerCase() === 'race');

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
  const raceSessionKey = useMemo(() => {
    const raceSession = sessions.find(
      (session) => session.session_type?.toLowerCase() === 'race' || session.session_name?.toLowerCase() === 'race',
    );
    return raceSession?.session_key ?? null;
  }, [sessions]);
  const startingGridSessionKey = useMemo(() => {
    if (!selectedSession) {
      return null;
    }

    if (selectedSession.session_type?.toLowerCase() === 'race') {
      const qualifyingSession = sessions.find(
        (session) =>
          session.session_type?.toLowerCase() === 'qualifying' ||
          session.session_name?.toLowerCase().includes('qualifying'),
      );
      return qualifyingSession?.session_key ?? selectedSession.session_key;
    }

    return selectedSession.session_key;
  }, [selectedSession, sessions]);
  const championshipSessionKey = raceSessionKey ?? (selectedSession?.session_type?.toLowerCase() === 'race' ? selectedSession.session_key : null);

  const sessionResultQuery = useEndpointData<SessionResult>(
    'session_result',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    Boolean(selectedSessionKey),
  );
  const startingGridQuery = useEndpointData<StartingGridRow>(
    'starting_grid',
    startingGridSessionKey ? { session_key: startingGridSessionKey } : {},
    Boolean(startingGridSessionKey),
  );
  const lapsQuery = useEndpointData<LapRow>('laps', selectedSessionKey ? { session_key: selectedSessionKey } : {}, Boolean(selectedSessionKey));
  const stintsQuery = useEndpointData<StintRow>('stints', selectedSessionKey ? { session_key: selectedSessionKey } : {}, Boolean(selectedSessionKey));
  const intervalsQuery = useEndpointData<IntervalRow>('intervals', selectedSessionKey ? { session_key: selectedSessionKey } : {}, Boolean(selectedSessionKey));
  const positionQuery = useEndpointData<PositionRow>('position', selectedSessionKey ? { session_key: selectedSessionKey } : {}, Boolean(selectedSessionKey));

  const raceControlQuery = useEndpointData<RaceControlMessage>(
    'race_control',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    activeTab === 'events' && Boolean(selectedSessionKey),
  );
  const pitQuery = useEndpointData<PitRow>(
    'pit',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    activeTab === 'events' && Boolean(selectedSessionKey),
  );
  const overtakesQuery = useEndpointData<OvertakeRow>(
    'overtakes',
    selectedSessionKey ? { session_key: selectedSessionKey } : {},
    activeTab === 'events' && Boolean(selectedSessionKey),
  );
  const weatherQuery = useEndpointData<WeatherSample>(
    'weather',
    selectedMeetingKey ? { meeting_key: selectedMeetingKey } : {},
    activeTab === 'weather' && Boolean(selectedMeetingKey),
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
  );
  const telemetrySecondaryQuery = useEndpointData<CarDataSample>(
    'car_data',
    selectedSessionKey && telemetrySecondaryNumber
      ? { session_key: selectedSessionKey, driver_number: telemetrySecondaryNumber }
      : {},
    activeTab === 'telemetry' && Boolean(selectedSessionKey && telemetrySecondaryNumber),
  );
  const telemetryLocationQuery = useEndpointData<LocationSample>(
    'location',
    selectedSessionKey && telemetryPrimaryNumber
      ? { session_key: selectedSessionKey, driver_number: telemetryPrimaryNumber }
      : {},
    activeTab === 'telemetry' && Boolean(selectedSessionKey && telemetryPrimaryNumber),
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

  const eventRows = useMemo<EventFeedItem[]>(() => {
    const raceControlRows = raceControlQuery.data
      .filter((row) => !isMinorRaceControlMessage(row))
      .map((row, index) => ({
        id: `rc-${index}-${row.date}`,
        date: row.date,
        tone: getEventTone(row),
        headline: getEventHeading(row),
        body: safeText(row.message, 'Message non détaillé'),
        driverNumber: row.driver_number ? Number(row.driver_number) : undefined,
        sourceLabel: row.driver_number ? undefined : 'Race Control',
        lapLabel: row.lap_number ? `Tour ${row.lap_number}` : 'Session',
      }));

    const pitRows = pitQuery.data.map((row, index) => {
      const stop = toNumeric(row.stop_duration);
      const lane = toNumeric(row.lane_duration);
      const details = [
        stop !== null && stop < 180 ? `Arrêt ${formatDurationSeconds(stop)}` : null,
        lane !== null && lane < 180 ? `Voie ${formatDurationSeconds(lane)}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return {
        id: `pit-${index}-${row.date}-${row.driver_number}`,
        date: row.date,
        tone: 'is-warn',
        headline: 'Passage aux stands',
        body: details || 'Passage stand / garage',
        driverNumber: row.driver_number,
        lapLabel: row.lap_number ? `Tour ${row.lap_number}` : 'Stand',
      };
    });

    const overtakeRows = overtakesQuery.data.map((row, index) => {
      const attacker = row.overtaking_driver_number ? driverLookup.get(Number(row.overtaking_driver_number)) : undefined;
      const defender = row.overtaken_driver_number ? driverLookup.get(Number(row.overtaken_driver_number)) : undefined;
      const attackerCode = attacker ? getDriverCode(attacker) : `#${safeText(row.overtaking_driver_number)}`;
      const defenderCode = defender ? getDriverCode(defender) : `#${safeText(row.overtaken_driver_number)}`;

      return {
        id: `ot-${index}-${row.date}`,
        date: row.date,
        tone: 'is-ok',
        headline: 'Dépassement',
        body: `${attackerCode} passe ${defenderCode}${row.position ? ` pour P${row.position}` : ''}`,
        driverNumber: row.overtaking_driver_number ? Number(row.overtaking_driver_number) : undefined,
        sourceLabel: row.overtaking_driver_number ? undefined : 'Piste',
        lapLabel: row.position ? `P${row.position}` : 'Position',
      };
    });

    return [...raceControlRows, ...pitRows, ...overtakeRows]
      .sort((left, right) => parseOpenF1Date(right.date) - parseOpenF1Date(left.date))
      .slice(0, 18);
  }, [driverLookup, overtakesQuery.data, pitQuery.data, raceControlQuery.data]);
  const weatherRows = useMemo(() => downsample(sortByDate(weatherQuery.data), 120), [weatherQuery.data]);
  const latestWeather = weatherRows[weatherRows.length - 1];
  const championshipDrivers = useMemo<DriverStandingEntry[]>(
    () =>
      [...championshipDriversQuery.data]
        .sort((left, right) => Number(left.position_current ?? 999) - Number(right.position_current ?? 999))
        .map((row, index) => {
          const driver = driverLookup.get(Number(row.driver_number));
          const position = Number(row.position_current ?? index + 1);
          const positionStart = Number(row.position_start ?? 0);
          const points = toNumeric(row.points_current) ?? 0;
          const pointsStart = toNumeric(row.points_start) ?? null;
          const teamName = getTeamName(undefined, driver);
          return {
            driverNumber: Number(row.driver_number),
            position,
            positionDelta: positionStart ? positionStart - position : null,
            points,
            pointsDelta: pointsStart === null ? null : points - pointsStart,
            driver,
            accent: getTeamColor(undefined, driver),
            teamName,
          };
        }),
    [championshipDriversQuery.data, driverLookup],
  );
  const championshipTeams = useMemo<TeamStandingEntry[]>(
    () => {
      const hasCompleteEndpointRows = championshipTeamsQuery.data.length && championshipTeamsQuery.data.every((row) => row.team_name);
      if (hasCompleteEndpointRows) {
        return [...championshipTeamsQuery.data]
          .sort((left, right) => Number(left.position_current ?? 999) - Number(right.position_current ?? 999))
          .map((row, index) => {
            const position = Number(row.position_current ?? index + 1);
            const positionStart = Number(row.position_start ?? 0);
            const points = toNumeric(row.points_current) ?? 0;
            const pointsStart = toNumeric(row.points_start) ?? null;
            const teamName = safeText(row.team_name, 'Équipe');
            return {
              teamName,
              position,
              positionDelta: positionStart ? positionStart - position : null,
              points,
              pointsDelta: pointsStart === null ? null : points - pointsStart,
              accent: getTeamColor(teamName),
            };
          });
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
        pointsDelta: row.pointsStart === null ? null : row.points - row.pointsStart,
        accent: row.accent,
      }));
    },
    [championshipDriversQuery.data, championshipTeamsQuery.data, driverLookup],
  );
  const championshipLoading = championshipDriversQuery.loading || championshipTeamsQuery.loading;
  const championshipError =
    championshipDrivers.length || championshipTeams.length ? null : championshipDriversQuery.error || championshipTeamsQuery.error;

  const selectedEntry = classificationEntries.find((entry) => entry.driverNumber === selectedDriverNumber);
  const selectedDriver = selectedEntry?.driver || drivers.find((driver) => driver.driver_number === selectedDriverNumber);
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
      <div className="broadcast-topbar">
        <div className="brand-block">
          <h1>F1 Center</h1>
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
            <strong>{getSessionLabel(selectedSession?.session_name)} · {getSessionState(selectedSession)}</strong>
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
          <section className="panel wide-panel">
            <SectionHeading
              title="Événements de course"
              detail="Direction de course, stands et dépassements sur une seule timeline."
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
                      {driver ? (
                        <DriverChip driver={driver} accent={getTeamColor(undefined, driver)} compact />
                      ) : (
                        <span className="event-source">{row.sourceLabel || 'Session'}</span>
                      )}
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
        <span>{meetingsQuery.error || sessionsQuery.error || driversQuery.error || `${INTEGRATED_ENDPOINT_KEYS.length} endpoints OpenF1 intégrés`}</span>
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
        <span>Delta</span>
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
                <span className="standing-points-delta">{row.pointsDelta !== null ? `+${formatValue(row.pointsDelta)}` : 'n/d'}</span>
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
                <span className="standing-points-delta">{row.pointsDelta !== null ? `+${formatValue(row.pointsDelta)}` : 'n/d'}</span>
              </div>
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
