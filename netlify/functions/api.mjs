const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = "https://v3.football.api-sports.io";

const CACHE = new Map();

const PRIORITY_LEAGUES = [
  {
    id: 39,
    key: "eng",
    country: "England",
    name: "Premier League",
    ar: "الدوري الإنجليزي الممتاز",
    flag: "🏴",
  },
  {
    id: 140,
    key: "esp",
    country: "Spain",
    name: "La Liga",
    ar: "الدوري الإسباني",
    flag: "🇪🇸",
  },
  {
    id: 135,
    key: "ita",
    country: "Italy",
    name: "Serie A",
    ar: "الدوري الإيطالي",
    flag: "🇮🇹",
  },
  {
    id: 78,
    key: "ger",
    country: "Germany",
    name: "Bundesliga",
    ar: "الدوري الألماني",
    flag: "🇩🇪",
  },
  {
    id: 61,
    key: "fra",
    country: "France",
    name: "Ligue 1",
    ar: "الدوري الفرنسي",
    flag: "🇫🇷",
  },
  {
    id: 307,
    key: "sau",
    country: "Saudi-Arabia",
    name: "Pro League",
    ar: "الدوري السعودي",
    flag: "🇸🇦",
  },
  {
    id: 2,
    key: "ucl",
    country: "World",
    name: "UEFA Champions League",
    ar: "دوري أبطال أوروبا",
    flag: "🏆",
  },
  {
    id: 3,
    key: "uel",
    country: "World",
    name: "UEFA Europa League",
    ar: "الدوري الأوروبي",
    flag: "🏆",
  },
];

const IRAQ = {
  key: "iraq",
  country: "Iraq",
  name: "Iraq Stars League",
  ar: "دوري نجوم العراق",
  flag: "🇮🇶",
};

function cacheGet(key) {
  const item = CACHE.get(key);

  if (!item) return null;

  if (item.expires < Date.now()) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}

function cacheSet(key, value, ttl) {
  CACHE.set(key, {
    value,
    expires: Date.now() + ttl,
  });

  return value;
}

function leagueInfo(league) {
  if (!league) return null;

  const priority = PRIORITY_LEAGUES.find(
    (item) => item.id === league.id
  );

  if (priority) return priority;

  if (
    league.country === "Iraq" &&
    /Iraq|Iraqi/i.test(league.name || "")
  ) {
    return IRAQ;
  }

  return null;
}

function normalizeFixture(item) {
  const info = leagueInfo(item.league);

  if (!info) return null;

  return {
    id: item.fixture?.id,

    date: item.fixture?.date,

    timestamp: item.fixture?.timestamp,

    timezone: item.fixture?.timezone,

    status: item.fixture?.status || {},

    venue: item.fixture?.venue || {},

    league: {
      id: item.league?.id,
      name: item.league?.name,
      country: item.league?.country,
      logo: item.league?.logo,
      flag: item.league?.flag,
      ar: info.ar,
      key: info.key,
      flagEmoji: info.flag,
    },

    teams: {
      home: {
        id: item.teams?.home?.id,
        name: item.teams?.home?.name,
        logo: item.teams?.home?.logo,
        winner: item.teams?.home?.winner,
      },

      away: {
        id: item.teams?.away?.id,
        name: item.teams?.away?.name,
        logo: item.teams?.away?.logo,
        winner: item.teams?.away?.winner,
      },
    },

    goals: item.goals || {
      home: null,
      away: null,
    },
  };
}

async function apiFetch(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error("API_FOOTBALL_KEY is not configured");
  }

  const url = new URL(API_BASE + endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",

    headers: {
      "x-apisports-key": API_KEY,
      Accept: "application/json",
    },
  });

  const data = await response.json();

  if (
    !response.ok ||
    (data.errors && Object.keys(data.errors).length)
  ) {
    const error = new Error(
      JSON.stringify(
        data.errors || {
          status: response.status,
        }
      )
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,

    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
    },
  });
}

async function getCurrentSeason(leagueId) {
  const cacheKey = `season:${leagueId}`;

  const cached = cacheGet(cacheKey);

  if (cached) return cached;

  const data = await apiFetch("/leagues", {
    id: leagueId,
    current: "true",
  });

  const league = data.response?.[0];

  const seasons = league?.seasons || [];

  const current =
    seasons.find((season) => season.current) ||
    seasons[seasons.length - 1];

  if (!current?.year) {
    throw new Error(
      `No current season found for league ${leagueId}`
    );
  }

  return cacheSet(
    cacheKey,
    current.year,
    24 * 60 * 60 * 1000
  );
}

async function handleMatches(url) {
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(
      {
        error: "date must be YYYY-MM-DD",
      },
      400
    );
  }

  const cacheKey = `matches:${date}`;

  const cached = cacheGet(cacheKey);

  if (cached) {
    return json(cached);
  }

  const data = await apiFetch("/fixtures", {
    date,
    timezone: "Asia/Baghdad",
  });

  const matches = (data.response || [])
    .map(normalizeFixture)
    .filter(Boolean);

  const result = {
    date,
    results: matches.length,
    response: matches,
    source: "API-Football",
  };

  cacheSet(
    cacheKey,
    result,
    5 * 60 * 1000
  );

  return json(result);
}

async function handleMatch(id) {
  const fixtureId = Number(id);

  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return json(
      {
        error: "invalid fixture id",
      },
      400
    );
  }

  const cacheKey = `match:${fixtureId}`;

  const cached = cacheGet(cacheKey);

  if (cached) {
    return json(cached);
  }

  const data = await apiFetch("/fixtures", {
    id: fixtureId,
  });

  const match = data.response?.[0];

  if (!match) {
    return json(
      {
        error: "match not found",
      },
      404
    );
  }

  cacheSet(
    cacheKey,
    match,
    60 * 1000
  );

  return json(match);
}

async function handleTeam(id) {
  const teamId = Number(id);

  if (!Number.isInteger(teamId) || teamId <= 0) {
    return json(
      {
        error: "invalid team id",
      },
      400
    );
  }

  const cacheKey = `team:${teamId}`;

  const cached = cacheGet(cacheKey);

  if (cached) {
    return json(cached);
  }

  const data = await apiFetch("/teams", {
    id: teamId,
  });

  const team = data.response?.[0];

  if (!team) {
    return json(
      {
        error: "team not found",
      },
      404
    );
  }

  cacheSet(
    cacheKey,
    team,
    24 * 60 * 60 * 1000
  );

  return json(team);
}

async function handleStandings(url) {
  const leagueId = Number(
    url.searchParams.get("league")
  );

  if (!Number.isInteger(leagueId)) {
    return json(
      {
        error: "league is required",
      },
      400
    );
  }

  const seasonParam =
    url.searchParams.get("season");

  const season =
    Number(seasonParam) ||
    (await getCurrentSeason(leagueId));

  const cacheKey =
    `standings:${leagueId}:${season}`;

  const cached = cacheGet(cacheKey);

  if (cached) {
    return json(cached);
  }

  const data = await apiFetch("/standings", {
    league: leagueId,
    season,
  });

  const result = {
    league: leagueId,
    season,
    response: data.response || [],
  };

  cacheSet(
    cacheKey,
    result,
    60 * 60 * 1000
  );

  return json(result);
}

async function handleTopScorers(url) {
  const leagueId = Number(
    url.searchParams.get("league")
  );

  if (!Number.isInteger(leagueId)) {
    return json(
      {
        error: "league is required",
      },
      400
    );
  }

  const seasonParam =
    url.searchParams.get("season");

  const season =
    Number(seasonParam) ||
    (await getCurrentSeason(leagueId));

  const cacheKey =
    `scorers:${leagueId}:${season}`;

  const cached = cacheGet(cacheKey);

  if (cached) {
    return json(cached);
  }

  const data = await apiFetch(
    "/players/topscorers",
    {
      league: leagueId,
      season,
    }
  );

  const result = {
    league: leagueId,
    season,
    response: data.response || [],
  };

  cacheSet(
    cacheKey,
    result,
    6 * 60 * 60 * 1000
  );

  return json(result);
}

export default async (request) => {
  try {
    const url = new URL(request.url);

    const path =
      url.pathname.replace(
        /^\/api/,
        ""
      );

    if (path === "/health") {
      return json({
        ok: true,
        service: "yalla-kora-api",
        apiConfigured: Boolean(API_KEY),
        time: new Date().toISOString(),
      });
    }

    if (path === "/matches") {
      return await handleMatches(url);
    }

    if (path.startsWith("/match/")) {
      return await handleMatch(
        path.split("/")[2]
      );
    }

    if (path.startsWith("/team/")) {
      return await handleTeam(
        path.split("/")[2]
      );
    }

    if (path === "/standings") {
      return await handleStandings(url);
    }

    if (path === "/topscorers") {
      return await handleTopScorers(url);
    }

    return json(
      {
        error: "API route not found",
      },
      404
    );
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          error?.message ||
          "API error",
      },
      error?.status || 500
    );
  }
};
