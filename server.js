const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';
const CACHE = new Map();

const PRIORITY_LEAGUES = [
  { id: 39, key: 'eng', country: 'England', name: 'Premier League', ar: 'الدوري الإنجليزي الممتاز', flag: '🏴' },
  { id: 140, key: 'esp', country: 'Spain', name: 'La Liga', ar: 'الدوري الإسباني', flag: '🇪🇸' },
  { id: 135, key: 'ita', country: 'Italy', name: 'Serie A', ar: 'الدوري الإيطالي', flag: '🇮🇹' },
  { id: 78, key: 'ger', country: 'Germany', name: 'Bundesliga', ar: 'الدوري الألماني', flag: '🇩🇪' },
  { id: 61, key: 'fra', country: 'France', name: 'Ligue 1', ar: 'الدوري الفرنسي', flag: '🇫🇷' },
  { id: 307, key: 'sau', country: 'Saudi-Arabia', name: 'Pro League', ar: 'الدوري السعودي للمحترفين', flag: '🇸🇦' },
  { id: 2, key: 'ucl', country: 'World', name: 'UEFA Champions League', ar: 'دوري أبطال أوروبا', flag: '🏆' },
  { id: 3, key: 'uel', country: 'World', name: 'UEFA Europa League', ar: 'الدوري الأوروبي', flag: '🏆' }
];

const IRAQ = { key: 'iraq', country: 'Iraq', name: 'Iraqi League', ar: 'الدوري العراقي', flag: '🇮🇶' };

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit || hit.expires < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  CACHE.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
function priorityForLeague(league) {
  if (!league) return null;
  const found = PRIORITY_LEAGUES.find(x => x.id === league.id);
  if (found) return found;
  if (league.country === IRAQ.country && /Iraqi League/i.test(league.name || '')) return IRAQ;
  return null;
}
function normalizeFixture(x) {
  const p = priorityForLeague(x.league);
  if (!p) return null;
  return {
    id: x.fixture?.id,
    date: x.fixture?.date,
    timestamp: x.fixture?.timestamp,
    timezone: x.fixture?.timezone,
    status: x.fixture?.status || {},
    venue: x.fixture?.venue || {},
    league: {
      id: x.league?.id,
      name: x.league?.name,
      country: x.league?.country,
      logo: x.league?.logo,
      flag: x.league?.flag,
      ar: p.ar,
      key: p.key,
      flagEmoji: p.flag
    },
    teams: {
      home: { id: x.teams?.home?.id, name: x.teams?.home?.name, logo: x.teams?.home?.logo, winner: x.teams?.home?.winner },
      away: { id: x.teams?.away?.id, name: x.teams?.away?.name, logo: x.teams?.away?.logo, winner: x.teams?.away?.winner }
    },
    goals: x.goals || { home: null, away: null }
  };
}

async function apiFetch(endpoint, params = {}) {
  if (!API_KEY) {
    const err = new Error('API_FOOTBALL_KEY is not configured');
    err.status = 500;
    throw err;
  }
  const url = new URL(API_BASE + endpoint);
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const response = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY,
      'Accept': 'application/json'
    }
  });
  const data = await response.json();
  if (!response.ok || (data.errors && Object.keys(data.errors).length)) {
    const err = new Error(JSON.stringify(data.errors || { status: response.status }));
    err.status = response.status;
    throw err;
  }
  return data;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'yalla-kora-api',
    apiConfigured: Boolean(API_KEY),
    time: new Date().toISOString()
  });
});

app.get('/api/matches', async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const key = `matches:${date}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const data = await apiFetch('/fixtures', {
      date,
      timezone: 'Asia/Baghdad'
    });

    const matches = (data.response || []).map(normalizeFixture).filter(Boolean);
    const payload = {
      date,
      results: matches.length,
      response: matches,
      source: 'API-Football'
    };
    cacheSet(key, payload, 5 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'API error' });
  }
});

app.get('/api/match/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid fixture id' });
    const key = `match:${id}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const data = await apiFetch('/fixtures', { id });
    const payload = data.response?.[0] || null;
    if (!payload) return res.status(404).json({ error: 'match not found' });

    cacheSet(key, payload, 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'API error' });
  }
});

async function currentSeason(leagueId) {
  const key = `season:${leagueId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await apiFetch('/leagues', { id: leagueId, current: 'true' });
  const item = data.response?.[0];
  const season = item?.seasons?.find(s => s.current)?.year || item?.seasons?.at(-1)?.year;
  if (!season) throw new Error(`No current season for league ${leagueId}`);
  return cacheSet(key, season, 24 * 60 * 60 * 1000);
}

app.get('/api/standings', async (req, res) => {
  try {
    const leagueId = Number(req.query.league);
    if (!Number.isInteger(leagueId)) return res.status(400).json({ error: 'league is required' });
    const season = Number(req.query.season) || await currentSeason(leagueId);
    const key = `standings:${leagueId}:${season}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const data = await apiFetch('/standings', { league: leagueId, season });
    const payload = { league: leagueId, season, response: data.response || [] };
    cacheSet(key, payload, 60 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'API error' });
  }
});

app.get('/api/topscorers', async (req, res) => {
  try {
    const leagueId = Number(req.query.league);
    if (!Number.isInteger(leagueId)) return res.status(400).json({ error: 'league is required' });
    const season = Number(req.query.season) || await currentSeason(leagueId);
    const key = `scorers:${leagueId}:${season}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const data = await apiFetch('/players/topscorers', { league: leagueId, season });
    const payload = { league: leagueId, season, response: data.response || [] };
    cacheSet(key, payload, 6 * 60 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'API error' });
  }
});

app.get('/api/team/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid team id' });
    const key = `team:${id}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);
    const data = await apiFetch('/teams', { id });
    const payload = data.response?.[0] || null;
    if (!payload) return res.status(404).json({ error: 'team not found' });
    cacheSet(key, payload, 24 * 60 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'API error' });
  }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Yalla Kora running on port ${PORT}`);
});
