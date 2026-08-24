/* =========================================================
   STREAMBOX TV
   app.js
   TV AO VIVO + FILMES + SÉRIES
   Temporadas + Episódios
   PLAYER OTIMIZADO PARA GOOGLE TV
========================================================= */

"use strict";


/* =========================================================
   ELEMENTOS
========================================================= */

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];


/* =========================================================
   CONFIGURAÇÃO DE PERFORMANCE
========================================================= */

const CONFIG = {

  /*
   * Quantidade máxima de cards renderizados.
   * 60 é um bom equilíbrio para Google TV.
   */

  MAX_CARDS: 60,

  /*
   * Tempo do debounce da busca.
   */

  SEARCH_DEBOUNCE: 250,

  /*
   * Tempo para esconder controles do player.
   */

  CONTROLS_TIMEOUT: 4000,

  /*
   * Limite de cache de séries.
   */

  MAX_SERIES_CACHE: 30,

  /*
   * HLS otimizado para dispositivos de TV.
   */

  HLS: {

    enableWorker: true,

    lowLatencyMode: true,

    backBufferLength: 10,

    maxBufferLength: 12,

    maxMaxBufferLength: 24,

    liveSyncDurationCount: 3,

    liveMaxLatencyDurationCount: 5,

    capLevelToPlayerSize: true,

    startLevel: -1

  }

};


/* =========================================================
   ESTADO
========================================================= */

const state = {

  server: "",
  username: "",
  password: "",

  section: "live",

  categories: {

    live: [],
    vod: [],
    series: []

  },

  items: [],

  category: null,

  cache: new Map(),

  seriesCache: new Map(),

  currentItem: null,

  currentSeries: null,

  currentSeason: null,

  seriesInfo: null,

  seriesView: "series",

  searchOpen: false,

  searchTimer: null,

  hls: null,

  connected: false,

  playerOpen: false,

  controlsTimer: null,

  loadingPlayer: false,

  lastFocusedCard: null,

  renderVersion: 0

};


/* =========================================================
   UTILIDADES
========================================================= */

function esc(value = "") {

  return String(value)
    .replace(
      /[&<>"']/g,
      (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
    );

}


function cleanServer(server) {

  return String(server || "")
    .trim()
    .replace(/\/+$/, "");

}


function setStatus(text, ok = true) {

  const status = $("#status");

  if (!status)
    return;

  status.textContent = text;

  status.style.color =
    ok
      ? "#80d99e"
      : "#ff9ca2";

}


function saveAccount() {

  localStorage.setItem(
    "streambox_tv_account",
    JSON.stringify({

      server:
        state.server,

      username:
        state.username,

      password:
        state.password

    })
  );

}


function loadAccount() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "streambox_tv_account"
      ) || "null"
    );

  } catch {

    return null;

  }

}


function clearAccount() {

  localStorage.removeItem(
    "streambox_tv_account"
  );

}


/* =========================================================
   API
========================================================= */

async function api(
  path,
  body = {}
) {

  const response =
    await fetch(
      path,
      {

        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(body)

      }
    );


  const data =
    await response
      .json()
      .catch(() => ({}));


  if (!response.ok) {

    throw new Error(
      data.error ||
      `HTTP ${response.status}`
    );

  }


  return data;

}


/* =========================================================
   CREDENCIAIS
========================================================= */

function getCredentials() {

  return {

    server:
      state.server,

    username:
      state.username,

    password:
      state.password

  };

}


/* =========================================================
   CONEXÃO
========================================================= */

async function connect(
  auto = false
) {

  const serverInput =
    $("#server");

  const usernameInput =
    $("#username");

  const passwordInput =
    $("#password");


  const server =
    cleanServer(
      serverInput?.value
    );

  const username =
    String(
      usernameInput?.value || ""
    ).trim();

  const password =
    String(
      passwordInput?.value || ""
    );


  if (
    !server ||
    !username ||
    !password
  ) {

    setStatus(
      "Configure a lista",
      false
    );


    if (!auto) {

      alert(
        "Informe servidor, usuário e senha."
      );

    }


    return false;

  }


  if (
    !/^https?:\/\//i.test(
      server
    )
  ) {

    setStatus(
      "Servidor inválido",
      false
    );


    if (!auto) {

      alert(
        "O servidor precisa começar com http:// ou https://"
      );

    }


    return false;

  }


  state.server =
    server;

  state.username =
    username;

  state.password =
    password;


  try {

    setStatus(
      "Conectando...",
      false
    );


    await api(
      "/api/login",
      getCredentials()
    );


    const categories =
      await api(
        "/api/categories",
        getCredentials()
      );


    state.categories = {

      live:
        Array.isArray(
          categories.live
        )
          ? categories.live
          : [],

      vod:
        Array.isArray(
          categories.vod
        )
          ? categories.vod
          : [],

      series:
        Array.isArray(
          categories.series
        )
          ? categories.series
          : []

    };


    state.cache.clear();

    state.seriesCache.clear();

    state.connected =
      true;

    saveAccount();


    setStatus(
      "Conectado",
      true
    );


    const dialog =
      $("#settings");


    if (
      dialog?.open
    ) {

      dialog.close();

    }


    await selectSection(
      "live"
    );


    return true;


  } catch (error) {

    console.error(
      "[CONNECT]",
      error
    );


    state.connected =
      false;


    setStatus(
      "Reconexão falhou",
      false
    );


    if (!auto) {

      alert(
        error.message ||
        "Não foi possível conectar."
      );

    }


    return false;

  }

}


/* =========================================================
   SEÇÕES
========================================================= */

async function selectSection(
  section
) {

  if (
    ![
      "live",
      "vod",
      "series"
    ].includes(section)
  ) {

    return;

  }


  if (
    state.playerOpen
  ) {

    await closePlayer();

  }


  state.section =
    section;

  state.category =
    null;

  state.items =
    [];

  state.seriesView =
    "series";

  state.currentSeries =
    null;

  state.currentSeason =
    null;

  state.seriesInfo =
    null;


  $$(".nav-btn")
    .forEach(
      (button) => {

        button.classList.toggle(
          "active",
          button.dataset.section ===
            section
        );

      }
    );


  const titles = {

    live:
      "TV AO VIVO",

    vod:
      "FILMES",

    series:
      "SÉRIES"

  };


  if ($("#title")) {

    $("#title").textContent =
      titles[section];

  }


  updateHeroForSection(
    section
  );


  renderCategories();


  if (
    section === "live"
  ) {

    state.category = {

      category_id:
        "principal",

      category_name:
        "PRINCIPAIS"

    };


    renderCategories();


    await loadCategory(
      state.category
    );


    return;

  }


  const list =
    state.categories[
      section
    ] || [];


  if (
    list.length > 0
  ) {

    await loadCategory(
      list[0]
    );

  } else {

    state.items =
      [];

    renderItems();

  }

}


/* =========================================================
   CATEGORIAS
========================================================= */

function getCategoryList() {

  const result = [];


  if (
    state.section === "live"
  ) {

    result.push({

      category_id:
        "principal",

      category_name:
        "⭐ PRINCIPAIS"

    });

  }


  const categories =
    state.categories[
      state.section
    ] || [];


  return [
    ...result,
    ...categories
  ];

}


function renderCategories() {

  const container =
    $("#categories");


  if (!container)
    return;


  const list =
    getCategoryList();


  const titles = {

    live:
      "CATEGORIAS DE TV",

    vod:
      "CATEGORIAS DE FILMES",

    series:
      "CATEGORIAS DE SÉRIES"

  };


  let html = `

    <div class="cat-title">
      ${titles[state.section]}
    </div>

  `;


  html += list
    .map(
      (category) => {

        const active =
          String(
            state.category?.category_id
          ) ===
          String(
            category.category_id
          );


        return `

          <button
            class="category-pill ${
              active
                ? "active"
                : ""
            }"
            data-category-id="${esc(
              category.category_id
            )}"
            tabindex="0"
          >

            ${esc(
              category.category_name ||
              "Categoria"
            )}

          </button>

        `;

      }
    )
    .join("");


  container.innerHTML =
    html;


  /*
   * Delegação de eventos.
   * Um único listener em vez de
   * um listener para cada categoria.
   */

  container.onclick =
    async (event) => {

      const button =
        event.target.closest(
          ".category-pill"
        );


      if (!button)
        return;


      const category =
        list.find(
          (item) =>
            String(
              item.category_id
            ) ===
            String(
              button.dataset
                .categoryId
            )
        );


      if (!category)
        return;


      await loadCategory(
        category
      );

    };

}


/* =========================================================
   CARREGAR CATEGORIA
========================================================= */

async function loadCategory(
  category
) {

  if (!category)
    return;


  state.category =
    category;


  state.seriesView =
    "series";

  state.currentSeries =
    null;

  state.currentSeason =
    null;

  state.seriesInfo =
    null;


  renderCategories();


  const key =
    `${state.section}:${category.category_id}`;


  if (
    state.cache.has(key)
  ) {

    state.items =
      state.cache.get(key);

    renderItems();

    return;

  }


  if ($("#count")) {

    $("#count").textContent =
      "Carregando...";

  }


  try {

    const data =
      await api(
        "/api/items",
        {

          ...getCredentials(),

          type:
            state.section,

          categoryId:
            category.category_id

        }
      );


    state.items =
      Array.isArray(data)
        ? data
        : [];


    state.cache.set(
      key,
      state.items
    );


    renderItems();


  } catch (error) {

    console.error(
      "[CATEGORY]",
      error
    );


    state.items =
      [];


    if ($("#count")) {

      $("#count").textContent =
        "Erro";

    }


    alert(
      error.message ||
      "Erro ao carregar conteúdo."
    );

  }

}


/* =========================================================
   ITEM DATA
========================================================= */

function itemData(item) {

  if (
    state.section === "live"
  ) {

    return {

      id:
        String(
          item.stream_id
        ),

      name:
        item.name ||
        "Canal",

      logo:
        item.stream_icon ||
        "",

      path:
        `/live/${encodeURIComponent(
          state.username
        )}/${encodeURIComponent(
          state.password
        )}/${encodeURIComponent(
          item.stream_id
        )}.m3u8`,

      type:
        "live"

    };

  }


  if (
    state.section === "vod"
  ) {

    const extension =
      item.container_extension ||
      "mp4";


    return {

      id:
        String(
          item.stream_id
        ),

      name:
        item.name ||
        "Filme",

      logo:
        item.stream_icon ||
        "",

      path:
        `/movie/${encodeURIComponent(
          state.username
        )}/${encodeURIComponent(
          state.password
        )}/${encodeURIComponent(
          item.stream_id
        )}.${extension}`,

      type:
        "vod"

    };

  }


  return {

    id:
      String(
        item.series_id
      ),

    name:
      item.name ||
      "Série",

    logo:
      item.cover ||
      item.stream_icon ||
      "",

    path:
      "",

    type:
      "series"

  };

}


/* =========================================================
   RENDER PRINCIPAL
========================================================= */

function renderItems() {

  if (
    state.section === "series"
  ) {

    if (
      state.seriesView ===
      "seasons"
    ) {

      renderSeriesSeasons();

      return;

    }


    if (
      state.seriesView ===
      "episodes"
    ) {

      renderSeriesEpisodes();

      return;

    }

  }


  renderStandardItems();

}


/* =========================================================
   RENDER FILMES / CANAIS / SÉRIES
========================================================= */

function renderStandardItems() {

  const container =
    $("#items");


  if (!container)
    return;


  const search =
    String(
      $("#search")?.value || ""
    )
      .toLowerCase()
      .trim();


  let items =
    state.items;


  /*
   * Busca somente quando necessária.
   */

  if (search) {

    items =
      state.items.filter(
        (item) =>
          String(
            item.name || ""
          )
            .toLowerCase()
            .includes(search)
      );

  }


  /*
   * Limite de cards.
   */

  items =
    items.slice(
      0,
      CONFIG.MAX_CARDS
    );


  if ($("#count")) {

    const total =
      search
        ? state.items.filter(
            (item) =>
              String(
                item.name || ""
              )
                .toLowerCase()
                .includes(search)
          ).length
        : state.items.length;


    $("#count").textContent =
      `${Math.min(
        total,
        CONFIG.MAX_CARDS
      )} de ${total}`;

  }


  if (
    items.length === 0
  ) {

    container.innerHTML =
      "";


    $("#empty")
      ?.classList.remove(
        "hidden"
      );


    return;

  }


  const fragment =
    document.createDocumentFragment();


  /*
   * innerHTML único.
   * Muito mais rápido que criar
   * dezenas de elementos individualmente.
   */

  container.innerHTML =
    items
      .map(
        (item, index) => {

          const data =
            itemData(item);


          return `

            <article
              class="movie-card"
              tabindex="0"
              data-index="${index}"
            >

              <div
                class="movie-poster"
              >

                ${
                  data.logo

                    ? `

                      <img
                        loading="lazy"
                        decoding="async"
                        width="300"
                        height="450"
                        src="${esc(
                          data.logo
                        )}"
                        alt="${esc(
                          data.name
                        )}"
                        onerror="
                          this.removeAttribute('src');
                          this.style.display='none';
                        "
                      >

                    `

                    : `

                      <div
                        class="poster-placeholder"
                      >
                        ▶
                      </div>

                    `
                }

              </div>


              <div
                class="movie-name"
              >

                ${esc(
                  data.name
                )}

              </div>

            </article>

          `;

        }
      )
      .join("");


  $("#empty")
    ?.classList.add(
      "hidden"
    );


  /*
   * Um único evento para toda a grade.
   */

  bindCardDelegation();

}


/* =========================================================
   EVENTOS DOS CARDS
========================================================= */

let cardsDelegationBound =
  false;


function bindCardDelegation() {

  const container =
    $("#items");


  if (
    !container ||
    cardsDelegationBound
  ) {

    return;

  }


  cardsDelegationBound =
    true;


  container.addEventListener(
    "click",
    (event) => {

      const card =
        event.target.closest(
          ".movie-card"
        );


      if (!card)
        return;


      /*
       * Cards especiais das séries.
       */

      if (
        card.dataset.action
      ) {

        handleSpecialCard(
          card
        );

        return;

      }


      const index =
        Number(
          card.dataset.index
        );


      const item =
        getVisibleItems()[index];


      if (!item)
        return;


      if (
        state.seriesView ===
        "series" &&
        state.section ===
        "series"
      ) {

        loadSeriesInfo(
          item
        );

        return;

      }


      playItem(
        item
      );

    }
  );


  container.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key !==
          "Enter" &&
        event.key !==
          " "
      ) {

        return;

      }


      const card =
        event.target.closest(
          ".movie-card"
        );


      if (!card)
        return;


      event.preventDefault();


      if (
        card.dataset.action
      ) {

        handleSpecialCard(
          card
        );

        return;

      }


      const index =
        Number(
          card.dataset.index
        );


      const item =
        getVisibleItems()[index];


      if (!item)
        return;


      if (
        state.seriesView ===
        "series" &&
        state.section ===
        "series"
      ) {

        loadSeriesInfo(
          item
        );

        return;

      }


      playItem(
        item
      );

    }
  );

}


function getVisibleItems() {

  const search =
    String(
      $("#search")?.value || ""
    )
      .toLowerCase()
      .trim();


  if (!search) {

    return state.items.slice(
      0,
      CONFIG.MAX_CARDS
    );

  }


  return state.items
    .filter(
      (item) =>
        String(
          item.name || ""
        )
          .toLowerCase()
          .includes(search)
    )
    .slice(
      0,
      CONFIG.MAX_CARDS
    );

}


/* =========================================================
   CARDS ESPECIAIS
========================================================= */

function handleSpecialCard(
  card
) {

  const action =
    card.dataset.action;


  if (
    action ===
    "back-series"
  ) {

    state.currentSeries =
      null;

    state.seriesInfo =
      null;

    state.currentSeason =
      null;

    state.seriesView =
      "series";


    if ($("#title")) {

      $("#title").textContent =
        "SÉRIES";

    }


    renderCategories();

    renderStandardItems();

    return;

  }


  if (
    action ===
    "back-seasons"
  ) {

    state.currentSeason =
      null;

    state.seriesView =
      "seasons";

    renderSeriesSeasons();

  }

}


/* =========================================================
   SÉRIES — CACHE
========================================================= */

function getSeriesCacheKey(
  seriesId
) {

  return `${state.server}|${state.username}|${seriesId}`;

}


function saveSeriesCache(
  key,
  value
) {

  /*
   * Evita cache infinito.
   */

  if (
    state.seriesCache.size >=
    CONFIG.MAX_SERIES_CACHE
  ) {

    const firstKey =
      state.seriesCache.keys()
        .next()
        .value;


    if (firstKey) {

      state.seriesCache.delete(
        firstKey
      );

    }

  }


  state.seriesCache.set(
    key,
    value
  );

}


/* =========================================================
   SÉRIES — CARREGAR INFORMAÇÕES
========================================================= */

async function loadSeriesInfo(
  item
) {

  if (!item)
    return;


  const seriesId =
    item.series_id;


  if (!seriesId) {

    alert(
      "ID da série não encontrado."
    );

    return;

  }


  state.lastFocusedCard =
    document.activeElement;


  const cacheKey =
    getSeriesCacheKey(
      seriesId
    );


  /*
   * Usa cache imediatamente.
   */

  if (
    state.seriesCache.has(
      cacheKey
    )
  ) {

    const cached =
      state.seriesCache.get(
        cacheKey
      );


    applySeriesInfo(
      item,
      cached
    );


    return;

  }


  try {

    setStatus(
      "Carregando série...",
      false
    );


    const data =
      await api(
        "/api/series/info",
        {

          ...getCredentials(),

          seriesId:
            seriesId

        }
      );


    console.log(
      "[SERIES] Dados carregados:",
      item.name
    );


    saveSeriesCache(
      cacheKey,
      data
    );


    applySeriesInfo(
      item,
      data
    );


  } catch (error) {

    console.error(
      "[SERIES INFO]",
      error
    );


    setStatus(
      "Erro ao carregar série",
      false
    );


    alert(
      error.message ||
      "Não foi possível carregar a série."
    );

  }

}


/* =========================================================
   APLICAR INFORMAÇÕES DA SÉRIE
========================================================= */

function applySeriesInfo(
  item,
  data
) {

  const info =
    data?.info || {};


  const episodes =
    data?.episodes || {};


  let seasons =
    Array.isArray(
      data?.seasons
    )
      ? data.seasons
      : [];


  /*
   * Se não houver seasons,
   * cria pelas chaves de episodes.
   */

  if (
    seasons.length === 0 &&
    episodes &&
    typeof episodes ===
      "object" &&
    !Array.isArray(episodes)
  ) {

    seasons =
      Object.keys(
        episodes
      )
      .filter(
        key =>
          /^\d+$/.test(key)
      )
      .sort(
        (a, b) =>
          Number(a) -
          Number(b)
      )
      .map(
        number => ({

          season_number:
            Number(number),

          name:
            `Temporada ${number}`,

          episode_count:
            Array.isArray(
              episodes[number]
            )
              ? episodes[number].length
              : 0,

          cover:
            "",

          overview:
            ""

        })
      );

  }


  /*
   * Episodes como array.
   */

  if (
    seasons.length === 0 &&
    Array.isArray(
      episodes
    ) &&
    episodes.length > 0
  ) {

    const grouped =
      {};


    episodes.forEach(
      episode => {

        const seasonNumber =
          Number(
            episode.season ??
            episode.season_number ??
            1
          );


        if (
          !grouped[seasonNumber]
        ) {

          grouped[seasonNumber] =
            [];

        }


        grouped[seasonNumber]
          .push(
            episode
          );

      }
    );


    seasons =
      Object.keys(grouped)
        .sort(
          (a, b) =>
            Number(a) -
            Number(b)
        )
        .map(
          number => ({

            season_number:
              Number(number),

            name:
              `Temporada ${number}`,

            episode_count:
              grouped[number].length,

            episodes:
              grouped[number],

            cover:
              "",

            overview:
              ""

          })
        );

  }


  /*
   * Guarda tudo no estado.
   */

  state.currentSeries = {

    ...item,

    ...(info || {})

  };


  state.seriesInfo = {

    ...data,

    info,

    seasons,

    episodes

  };


  state.currentSeason =
    null;


  state.seriesView =
    "seasons";


  /*
   * AQUI ESTÁ A CORREÇÃO IMPORTANTE:
   *
   * Não chamamos renderSeriesDetails(),
   * porque essa função não existe.
   *
   * O fluxo correto é:
   *
   * Série → temporadas
   */

  renderSeriesSeasons();


  setStatus(
    "Série carregada",
    true
  );

}


/* =========================================================
   NORMALIZAR TEMPORADAS
========================================================= */

function getSeasons() {

  const info =
    state.seriesInfo;


  if (!info)
    return [];


  if (
    Array.isArray(
      info.seasons
    )
  ) {

    return info.seasons;

  }


  if (
    info.seasons &&
    typeof info.seasons ===
      "object"
  ) {

    return Object.entries(
      info.seasons
    )
      .map(
        ([number, value]) => {

          if (
            value &&
            typeof value ===
              "object"
          ) {

            return {

              ...value,

              season_number:
                value.season_number ??
                Number(number)

            };

          }


          return {

            season_number:
              Number(number),

            name:
              `Temporada ${number}`,

            episodes:
              []

          };

        }
      );

  }


  return [];

}


/* =========================================================
   TEMPORADA — NOME
========================================================= */

function seasonName(
  season
) {

  return (
    season?.name ||
    season?.title ||
    `Temporada ${
      season?.season_number ??
      season?.number ??
      ""
    }`
  );

}


/* =========================================================
   TEMPORADAS
========================================================= */

function renderSeriesSeasons() {

  const container =
    $("#items");


  if (!container)
    return;


  const series =
    state.currentSeries;


  if (!series) {

    state.seriesView =
      "series";

    renderStandardItems();

    return;

  }


  const seasons =
    getSeasons();


  if ($("#title")) {

    $("#title").textContent =
      series.name ||
      "Série";

  }


  if ($("#count")) {

    $("#count").textContent =
      `${seasons.length} temporada${
        seasons.length === 1
          ? ""
          : "s"
      }`;

  }


  if (
    seasons.length === 0
  ) {

    container.innerHTML =
      `

        <article
          class="movie-card series-back-card"
          tabindex="0"
          data-action="back-series"
        >

          <div class="movie-poster poster-placeholder">
            ←
          </div>

          <div class="movie-name">
            VOLTAR PARA SÉRIES
          </div>

        </article>

      `;


    $("#empty")
      ?.classList.remove(
        "hidden"
      );


    return;

  }


  let html = `

    <article
      class="movie-card series-back-card"
      tabindex="0"
      data-action="back-series"
    >

      <div class="movie-poster poster-placeholder">
        ←
      </div>

      <div class="movie-name">
        VOLTAR PARA SÉRIES
      </div>

    </article>

  `;


  html += seasons
    .map(
      (season, index) => {

        const number =
          season.season_number ??
          season.number ??
          index + 1;


        const episodeCount =
          Array.isArray(
            season.episodes
          )
            ? season.episodes.length
            : (
                season.episode_count ??
                season.episodes_count ??
                ""
              );


        const cover =
          season.cover ||
          season.cover_big ||
          series.cover ||
          series.stream_icon ||
          "";


        return `

          <article
            class="movie-card season-card"
            tabindex="0"
            data-season-index="${index}"
          >

            <div
              class="movie-poster"
            >

              ${
                cover

                  ? `

                    <img
                      loading="lazy"
                      decoding="async"
                      width="300"
                      height="450"
                      src="${esc(
                        cover
                      )}"
                      alt="${esc(
                        seasonName(
                          season
                        )
                      )}"
                      onerror="
                        this.removeAttribute('src');
                        this.style.display='none';
                      "
                    >

                  `

                  : `

                    <div
                      class="poster-placeholder season-number"
                    >

                      ${esc(
                        String(number)
                      )}

                    </div>

                  `
              }

            </div>


            <div
              class="movie-name"
            >

              ${esc(
                seasonName(
                  season
                )
              )}

              ${
                episodeCount
                  ? `
                    <small>
                      ${esc(
                        String(
                          episodeCount
                        )
                      )}
                      episódios
                    </small>
                  `
                  : ""
              }

            </div>

          </article>

        `;

      }
    )
    .join("");


  container.innerHTML =
    html;


  $("#empty")
    ?.classList.add(
      "hidden"
    );


  /*
   * Eventos delegados.
   */

  container
    .querySelectorAll(
      ".season-card"
    )
    .forEach(
      (card) => {

        /*
         * Apenas guardamos índice.
         * O clique principal é tratado
         * pelo listener delegado.
         */

        card.onclick =
          () => {

            const index =
              Number(
                card.dataset
                  .seasonIndex
              );


            openSeason(
              seasons[index]
            );

          };


        card.onkeydown =
          (event) => {

            if (
              event.key ===
                "Enter" ||
              event.key ===
                " "
            ) {

              event.preventDefault();

              const index =
                Number(
                  card.dataset
                    .seasonIndex
                );


              openSeason(
                seasons[index]
              );

            }

          };

      }
    );

}


/* =========================================================
   ABRIR TEMPORADA
========================================================= */

function openSeason(
  season
) {

  if (!season)
    return;


  state.currentSeason =
    season;


  /*
   * Caso a temporada não tenha
   * episódios embutidos, tenta
   * localizar no objeto geral.
   */

  const number =
    season.season_number ??
    season.number;


  if (
    !Array.isArray(
      season.episodes
    )
  ) {

    const source =
      state.seriesInfo?.episodes;


    if (
      source &&
      typeof source ===
        "object" &&
      !Array.isArray(source)
    ) {

      const found =
        source[String(number)];


      if (
        Array.isArray(found)
      ) {

        state.currentSeason =
          {

            ...season,

            episodes:
              found

          };

      }

    }

  }


  state.seriesView =
    "episodes";


  renderSeriesEpisodes();

}


/* =========================================================
   EPISÓDIOS
========================================================= */

function getEpisodes() {

  const season =
    state.currentSeason;


  if (!season)
    return [];


  if (
    Array.isArray(
      season.episodes
    )
  ) {

    return season.episodes;

  }


  if (
    season.episodes &&
    typeof season.episodes ===
      "object"
  ) {

    return Object.values(
      season.episodes
    );

  }


  const allEpisodes =
    state.seriesInfo?.episodes;


  /*
   * Array global.
   */

  if (
    Array.isArray(
      allEpisodes
    )
  ) {

    const seasonNumber =
      season.season_number ??
      season.number;


    return allEpisodes.filter(
      (episode) =>
        String(
          episode.season ??
          episode.season_number
        ) ===
        String(
          seasonNumber
        )
    );

  }


  /*
   * Objeto indexado por temporada.
   */

  if (
    allEpisodes &&
    typeof allEpisodes ===
      "object"
  ) {

    const seasonNumber =
      season.season_number ??
      season.number;


    const episodes =
      allEpisodes[
        String(seasonNumber)
      ];


    if (
      Array.isArray(
        episodes
      )
    ) {

      return episodes;

    }

  }


  return [];

}


/* =========================================================
   EPISÓDIO DATA
========================================================= */

function episodeData(
  episode
) {

  const extension =
    episode.container_extension ||
    episode.extension ||
    "mp4";


  const id =
    episode.id ??
    episode.episode_id ??
    episode.stream_id;


  return {

    id:
      String(
        id ?? ""
      ),

    name:
      episode.title ||
      episode.name ||
      `Episódio ${
        episode.episode_num ??
        episode.episode_number ??
        ""
      }`,

    number:
      episode.episode_num ??
      episode.episode_number ??
      "",

    plot:
      episode.plot ||
      "",

    logo:
      episode.movie_image ||
      episode.image ||
      episode.cover ||
      episode.stream_icon ||
      state.currentSeries?.cover ||
      "",

    extension,

    path:
      `/series/${encodeURIComponent(
        state.username
      )}/${encodeURIComponent(
        state.password
      )}/${encodeURIComponent(
        id
      )}.${extension}`

  };

}


/* =========================================================
   RENDER EPISÓDIOS
========================================================= */

function renderSeriesEpisodes() {

  const container =
    $("#items");


  if (!container)
    return;


  const series =
    state.currentSeries;


  const season =
    state.currentSeason;


  if (
    !series ||
    !season
  ) {

    return;

  }


  const episodes =
    getEpisodes();


  if ($("#title")) {

    $("#title").textContent =
      `${series.name || "Série"} — ${
        seasonName(season)
      }`;

  }


  if ($("#count")) {

    $("#count").textContent =
      `${episodes.length} episódio${
        episodes.length === 1
          ? ""
          : "s"
      }`;

  }


  let html = `

    <article
      class="movie-card series-back-card"
      tabindex="0"
      data-action="back-seasons"
    >

      <div
        class="movie-poster poster-placeholder"
      >
        ←
      </div>

      <div
        class="movie-name"
      >
        VOLTAR PARA TEMPORADAS
      </div>

    </article>

  `;


  if (
    episodes.length > 0
  ) {

    html += episodes
      .map(
        (episode, index) => {

          const data =
            episodeData(
              episode
            );


          const number =
            data.number ||
            index + 1;


          return `

            <article
              class="movie-card episode-card"
              tabindex="0"
              data-episode-index="${index}"
            >

              <div
                class="movie-poster"
              >

                ${
                  data.logo

                    ? `

                      <img
                        loading="lazy"
                        decoding="async"
                        width="300"
                        height="450"
                        src="${esc(
                          data.logo
                        )}"
                        alt="${esc(
                          data.name
                        )}"
                        onerror="
                          this.removeAttribute('src');
                          this.style.display='none';
                        "
                      >

                    `

                    : `

                      <div
                        class="poster-placeholder episode-number"
                      >

                        E${esc(
                          String(number)
                        )}

                      </div>

                    `
                }

              </div>


              <div
                class="movie-name"
              >

                <span>
                  ${esc(
                    String(number)
                  )}.
                  ${esc(
                    data.name
                  )}
                </span>

              </div>

            </article>

          `;

        }
      )
      .join("");

  }


  container.innerHTML =
    html;


  $("#empty")
    ?.classList.toggle(
      "hidden",
      episodes.length > 0
    );


  /*
   * Eventos dos episódios.
   */

  container
    .querySelectorAll(
      ".episode-card"
    )
    .forEach(
      (card) => {

        const index =
          Number(
            card.dataset
              .episodeIndex
          );


        card.onclick =
          () => {

            playEpisode(
              episodes[index]
            );

          };


        card.onkeydown =
          (event) => {

            if (
              event.key ===
                "Enter" ||
              event.key ===
                " "
            ) {

              event.preventDefault();

              playEpisode(
                episodes[index]
              );

            }

          };

      }
    );

}


/* =========================================================
   PLAY EPISÓDIO
========================================================= */

async function playEpisode(
  episode
) {

  if (!episode)
    return;


  const data =
    episodeData(
      episode
    );


  state.lastFocusedCard =
    document.activeElement;


  state.currentItem =
    episode;


  await openPlayer();


  destroyPlayer();


  const proxy =
    `/proxy/stream?server=${encodeURIComponent(
      state.server
    )}&path=${encodeURIComponent(
      data.path
    )}`;


  console.log(
    "[SERIES] Episódio:",
    data.name
  );


  const video =
    $("#video");


  if (!video)
    return;


  const nowPlaying =
    $("#nowPlaying");

  const playerTitle =
    $("#playerTitle");


  if (nowPlaying) {

    nowPlaying.textContent =
      `${state.currentSeries?.name || "Série"} • ${data.name}`;

    nowPlaying.classList.remove(
      "hidden"
    );

  }


  if (playerTitle) {

    playerTitle.textContent =
      data.name;

  }


  const empty =
    $("#playerEmpty");


  empty?.classList.remove(
    "hidden"
  );


  state.loadingPlayer =
    true;


  await playVod(
    video,
    proxy
  );


  state.loadingPlayer =
    false;

}


/* =========================================================
   PLAYER — ABRIR
========================================================= */

async function openPlayer() {

  const player =
    $("#player");

  const video =
    $("#video");


  if (
    !player ||
    !video
  )
    return;


  state.playerOpen =
    true;


  player.classList.remove(
    "hidden"
  );


  document.body.classList.add(
    "player-active"
  );


  showPlayerControls();


  /*
   * Fullscreen real.
   */

  try {

    if (
      !document.fullscreenElement &&
      player.requestFullscreen
    ) {

      await player.requestFullscreen();

    } else if (
      !document.fullscreenElement &&
      video.webkitEnterFullscreen
    ) {

      video.webkitEnterFullscreen();

    }

  } catch (error) {

    console.warn(
      "[PLAYER] Fullscreen indisponível:",
      error
    );


    player.classList.add(
      "fullscreen-fallback"
    );

  }


  if (
    !document.fullscreenElement
  ) {

    player.classList.add(
      "fullscreen-fallback"
    );

  }

}


/* =========================================================
   PLAYER — FECHAR
========================================================= */

async function closePlayer() {

  const player =
    $("#player");


  if (!player)
    return;


  clearControlsTimer();


  destroyPlayer();


  state.currentItem =
    null;

  state.playerOpen =
    false;


  try {

    if (
      document.fullscreenElement
    ) {

      await document.exitFullscreen();

    }

  } catch (error) {

    console.warn(
      "[PLAYER] Erro fullscreen:",
      error
    );

  }


  player.classList.remove(
    "fullscreen-fallback"
  );

  player.classList.remove(
    "controls-visible"
  );

  player.classList.remove(
    "playing"
  );

  player.classList.add(
    "hidden"
  );


  document.body.classList.remove(
    "player-active"
  );


  setStatus(
    state.connected
      ? "Conectado"
      : "Desconectado",
    state.connected
  );


  if (
    state.lastFocusedCard
  ) {

    try {

      state.lastFocusedCard.focus();

    } catch {}

  }

}


/* =========================================================
   PLAYER — DESTROY
========================================================= */

function destroyPlayer() {

  const video =
    $("#video");


  if (
    state.hls
  ) {

    try {

      state.hls.destroy();

    } catch {}

    state.hls =
      null;

  }


  if (!video)
    return;


  try {

    video.pause();

  } catch {}


  video.removeAttribute(
    "src"
  );


  try {

    video.load();

  } catch {}

}


/* =========================================================
   PLAYER — PLAY ITEM
========================================================= */

async function playItem(
  item
) {

  if (!item)
    return;


  const data =
    itemData(item);


  state.lastFocusedCard =
    document.activeElement;


  /*
   * SÉRIE
   */

  if (
    data.type ===
    "series"
  ) {

    await loadSeriesInfo(
      item
    );

    return;

  }


  const video =
    $("#video");


  if (!video)
    return;


  state.currentItem =
    item;


  await openPlayer();


  destroyPlayer();


  const proxy =
    `/proxy/stream?server=${encodeURIComponent(
      state.server
    )}&path=${encodeURIComponent(
      data.path
    )}`;


  const nowPlaying =
    $("#nowPlaying");

  const playerTitle =
    $("#playerTitle");


  if (nowPlaying) {

    nowPlaying.textContent =
      data.name;

    nowPlaying.classList.remove(
      "hidden"
    );

  }


  if (playerTitle) {

    playerTitle.textContent =
      data.name;

  }


  const empty =
    $("#playerEmpty");


  empty?.classList.remove(
    "hidden"
  );


  state.loadingPlayer =
    true;


  if (
    data.type ===
    "live"
  ) {

    await playLive(
      video,
      proxy
    );

  } else {

    await playVod(
      video,
      proxy
    );

  }


  state.loadingPlayer =
    false;

}


/* =========================================================
   HLS LIVE
========================================================= */

/*
 * =========================================================
 * HLS.js — CARREGAMENTO SOB DEMANDA
 *
 * Antes, o hls.js (~100-150KB) era baixado sempre que a página
 * abria, mesmo que o usuário só fosse navegar pelo menu. Agora
 * só baixa na primeira vez que algo é realmente reproduzido.
 * =========================================================
 */

let _hlsLoadPromise = null;

function loadHlsLib() {

  if (typeof Hls !== "undefined") {
    return Promise.resolve();
  }

  if (_hlsLoadPromise) {
    return _hlsLoadPromise;
  }

  _hlsLoadPromise = new Promise((resolve, reject) => {

    const script = document.createElement("script");

    script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";

    script.onload = () => resolve();

    script.onerror = () => reject(
      new Error("Falha ao carregar hls.js")
    );

    document.head.appendChild(script);

  });

  return _hlsLoadPromise;

}


async function playLive(
  video,
  url
) {

  /*
   * Safari / dispositivos com HLS nativo.
   */

  if (
    video.canPlayType(
      "application/vnd.apple.mpegurl"
    )
  ) {

    video.src =
      url;

    video.load();


    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          50
        )
    );


    if (
      !state.playerOpen
    )
      return;


    try {

      await video.play();

    } catch (error) {

      if (
        error?.name !==
        "AbortError"
      ) {

        console.warn(
          "[PLAYER]",
          error
        );

      }

    }


    return;

  }


  /*
   * HLS.js — carregado sob demanda aqui, na primeira reprodução.
   */

  try {

    await loadHlsLib();

  } catch (error) {

    console.warn(
      "[PLAYER] Não foi possível carregar hls.js",
      error
    );

  }


  if (
    typeof Hls !==
      "undefined" &&
    Hls.isSupported()
  ) {

    const hls =
      new Hls(
        CONFIG.HLS
      );


    state.hls =
      hls;


    hls.on(
      Hls.Events.MEDIA_ATTACHED,
      () => {

        if (
          state.hls !== hls
        )
          return;


        hls.loadSource(
          url
        );

      }
    );


    hls.on(
      Hls.Events.MANIFEST_PARSED,
      async () => {

        if (
          state.hls !== hls ||
          !state.playerOpen
        ) {

          return;

        }


        try {

          await video.play();

        } catch (error) {

          if (
            error?.name !==
            "AbortError"
          ) {

            console.warn(
              "[PLAYER]",
              error
            );

          }

        }

      }
    );


    hls.on(
      Hls.Events.ERROR,
      (
        event,
        data
      ) => {

        console.error(
          "[HLS]",
          data
        );


        if (
          !data?.fatal
        )
          return;


        switch (
          data.type
        ) {

          case Hls.ErrorTypes.NETWORK_ERROR:

            try {

              hls.startLoad();

            } catch {}

            break;


          case Hls.ErrorTypes.MEDIA_ERROR:

            try {

              hls.recoverMediaError();

            } catch {}

            break;


          default:

            try {

              hls.destroy();

            } catch {}


            if (
              state.hls === hls
            ) {

              state.hls =
                null;

            }


            setStatus(
              "Erro no canal",
              false
            );

            break;

        }

      }
    );


    hls.attachMedia(
      video
    );


    return;

  }


  /*
   * Fallback.
   */

  video.src =
    url;

  video.load();


  try {

    await video.play();

  } catch (error) {

    if (
      error?.name !==
      "AbortError"
    ) {

      console.warn(
        "[PLAYER]",
        error
      );

    }

  }

}


/* =========================================================
   VOD
========================================================= */

async function playVod(
  video,
  url
) {

  video.src =
    url;


  video.load();


  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        50
      )
  );


  if (
    !state.playerOpen
  )
    return;


  try {

    await video.play();

  } catch (error) {

    if (
      error?.name !==
      "AbortError"
    ) {

      console.warn(
        "[PLAYER]",
        error
      );

    }

  }

}


/* =========================================================
   CONTROLES DO PLAYER
========================================================= */

function showPlayerControls() {

  const player =
    $("#player");


  if (!player)
    return;


  player.classList.add(
    "controls-visible"
  );


  clearControlsTimer();


  const video =
    $("#video");


  if (
    video &&
    !video.paused
  ) {

    state.controlsTimer =
      setTimeout(
        () => {

          player.classList.remove(
            "controls-visible"
          );

        },
        CONFIG.CONTROLS_TIMEOUT
      );

  }

}


function clearControlsTimer() {

  if (
    state.controlsTimer
  ) {

    clearTimeout(
      state.controlsTimer
    );

    state.controlsTimer =
      null;

  }

}


/* =========================================================
   PLAY / PAUSE
========================================================= */

async function togglePlayPause() {

  const video =
    $("#video");


  if (!video)
    return;


  showPlayerControls();


  if (
    video.paused
  ) {

    try {

      await video.play();

    } catch (error) {

      if (
        error?.name !==
        "AbortError"
      ) {

        console.warn(
          "[PLAYER]",
          error
        );

      }

    }

  } else {

    video.pause();

  }

}


/* =========================================================
   MUTE
========================================================= */

function toggleMute() {

  const video =
    $("#video");

  const button =
    $("#playerMute");


  if (!video)
    return;


  video.muted =
    !video.muted;


  if (button) {

    button.textContent =
      video.muted
        ? "🔇"
        : "🔊";

  }


  showPlayerControls();

}


/* =========================================================
   FULLSCREEN
========================================================= */

async function toggleFullscreen() {

  const player =
    $("#player");


  if (!player)
    return;


  try {

    if (
      document.fullscreenElement
    ) {

      await document.exitFullscreen();

    } else if (
      player.requestFullscreen
    ) {

      await player.requestFullscreen();

    } else {

      player.classList.toggle(
        "fullscreen-fallback"
      );

    }

  } catch (error) {

    console.warn(
      "[PLAYER] Fullscreen:",
      error
    );


    player.classList.toggle(
      "fullscreen-fallback"
    );

  }


  showPlayerControls();

}


/* =========================================================
   EVENTOS DO PLAYER
========================================================= */

$("#playerPlayPause")
  ?.addEventListener(
    "click",
    togglePlayPause
  );


$("#playerMute")
  ?.addEventListener(
    "click",
    toggleMute
  );


$("#playerFullscreen")
  ?.addEventListener(
    "click",
    toggleFullscreen
  );


$("#playerClose")
  ?.addEventListener(
    "click",
    () => {

      closePlayer();

    }
  );


/*
 * O antigo #playerExit foi removido
 * do HTML.
 *
 * Não precisamos mais registrar evento
 * para ele.
 */


$("#player")
  ?.addEventListener(
    "mousemove",
    showPlayerControls
  );


$("#player")
  ?.addEventListener(
    "click",
    (event) => {

      if (
        event.target ===
        $("#player")
      ) {

        const player =
          $("#player");


        if (
          player.classList
            .contains(
              "controls-visible"
            )
        ) {

          player.classList.remove(
            "controls-visible"
          );

        } else {

          showPlayerControls();

        }

      }

    }
  );


/* =========================================================
   VÍDEO
========================================================= */

$("#video")
  ?.addEventListener(
    "playing",
    () => {

      const player =
        $("#player");

      const empty =
        $("#playerEmpty");

      const button =
        $("#playerPlayPause");


      player?.classList.add(
        "playing"
      );


      empty?.classList.add(
        "hidden"
      );


      if (button) {

        button.textContent =
          "❚❚";

      }


      setStatus(
        "Reproduzindo",
        true
      );


      showPlayerControls();

    }
  );


$("#video")
  ?.addEventListener(
    "pause",
    () => {

      const button =
        $("#playerPlayPause");


      if (button) {

        button.textContent =
          "▶";

      }


      showPlayerControls();

    }
  );


$("#video")
  ?.addEventListener(
    "waiting",
    () => {

      setStatus(
        "Carregando...",
        false
      );

    }
  );


$("#video")
  ?.addEventListener(
    "error",
    () => {

      console.error(
        "[VIDEO ERROR]",
        $("#video")?.error
      );


      setStatus(
        "Erro no vídeo",
        false
      );

    }
  );


/* =========================================================
   FULLSCREEN CHANGE
========================================================= */

document.addEventListener(
  "fullscreenchange",
  () => {

    const player =
      $("#player");


    if (!player)
      return;


    if (
      document.fullscreenElement ===
      player
    ) {

      player.classList.add(
        "controls-visible"
      );

    } else if (
      state.playerOpen
    ) {

      closePlayer();

    }

  }
);


/* =========================================================
   HERO
========================================================= */

function updateHeroForSection(
  section
) {

  const title =
    $("#heroTitle");

  const meta =
    $("#heroMeta");

  const description =
    $("#heroDescription");


  if (!title)
    return;


  if (
    section ===
    "live"
  ) {

    title.textContent =
      "TV ao Vivo";


    if (meta) {

      meta.textContent =
        "Canais • Esportes • Notícias • Entretenimento";

    }


    if (description) {

      description.textContent =
        "Assista aos principais canais da sua lista IPTV em um só lugar.";

    }


    return;

  }


  if (
    section ===
    "vod"
  ) {

    title.textContent =
      "Filmes";


    if (meta) {

      meta.textContent =
        "Filmes • Cinema • Lançamentos";

    }


    if (description) {

      description.textContent =
        "Encontre seus filmes e escolha o que assistir.";

    }


    return;

  }


  title.textContent =
    "Séries";


  if (meta) {

    meta.textContent =
      "Séries • Temporadas • Episódios";

  }


  if (description) {

    description.textContent =
      "Escolha uma série, selecione a temporada e assista aos episódios.";

  }

}


/* =========================================================
   HERO PLAY
========================================================= */

function heroPlay() {

  if (
    state.items.length
  ) {

    playItem(
      state.items[0]
    );

    return;

  }


  alert(
    "Nenhum conteúdo carregado."
  );

}


/* =========================================================
   BUSCA
========================================================= */

function toggleSearch() {

  const panel =
    $("#searchPanel");

  const input =
    $("#search");


  if (!panel)
    return;


  state.searchOpen =
    !state.searchOpen;


  panel.classList.toggle(
    "open",
    state.searchOpen
  );


  if (
    state.searchOpen
  ) {

    input?.focus();

  } else {

    if (input) {

      input.value =
        "";

    }


    renderItems();

  }

}


$("#searchBtn")
  ?.addEventListener(
    "click",
    toggleSearch
  );


$("#search")
  ?.addEventListener(
    "input",
    () => {

      /*
       * Cancela a renderização anterior.
       */

      clearTimeout(
        state.searchTimer
      );


      state.searchTimer =
        setTimeout(
          () => {

            /*
             * Durante temporadas/
             * episódios não mexe na
             * navegação.
             */

            if (
              state.seriesView ===
                "series" ||
              state.section !==
                "series"
            ) {

              renderItems();

            }

          },
          CONFIG.SEARCH_DEBOUNCE
        );

    }
  );


/* =========================================================
   CONFIGURAÇÕES
========================================================= */

$("#settingsBtn")
  ?.addEventListener(
    "click",
    () => {

      $("#settings")
        ?.showModal();

    }
  );


$("#close")
  ?.addEventListener(
    "click",
    () => {

      $("#settings")
        ?.close();

    }
  );


/* =========================================================
   CONECTAR
========================================================= */

$("#connect")
  ?.addEventListener(
    "click",
    async () => {

      await connect(
        false
      );

    }
  );


/* =========================================================
   ESQUECER
========================================================= */

$("#forget")
  ?.addEventListener(
    "click",
    () => {

      clearAccount();


      state.server =
        "";

      state.username =
        "";

      state.password =
        "";

      state.connected =
        false;

      state.cache.clear();

      state.seriesCache.clear();


      if ($("#server")) {

        $("#server").value =
          "";

      }


      if ($("#username")) {

        $("#username").value =
          "";

      }


      if ($("#password")) {

        $("#password").value =
          "";

      }


      setStatus(
        "Desconectado",
        false
      );

    }
  );


/* =========================================================
   HERO
========================================================= */

$("#heroPlay")
  ?.addEventListener(
    "click",
    heroPlay
  );


/* =========================================================
   NAVEGAÇÃO
========================================================= */

function getCards() {

  return $$("#items .movie-card");

}


function getCategories() {

  return $$(".category-pill");

}


function getNav() {

  return $$(".nav-btn");

}


function moveHorizontal(
  elements,
  direction
) {

  const current =
    document.activeElement;


  const index =
    elements.indexOf(
      current
    );


  if (
    index === -1
  ) {

    elements[0]?.focus();

    return;

  }


  const next =
    index + direction;


  if (
    elements[next]
  ) {

    elements[next].focus();

  }

}


function moveVerticalCards(
  direction
) {

  const cards =
    getCards();


  const current =
    document.activeElement;


  const index =
    cards.indexOf(
      current
    );


  if (
    index === -1
  ) {

    cards[0]?.focus();

    return;

  }


  /*
   * Usa distância vertical para
   * determinar a linha.
   */

  const currentRect =
    current.getBoundingClientRect();


  let columns = 1;


  for (
    let i = 0;
    i < cards.length;
    i++
  ) {

    if (
      cards[i] ===
      current
    )
      continue;


    const rect =
      cards[i].getBoundingClientRect();


    if (
      Math.abs(
        rect.top -
        currentRect.top
      ) < 20
    ) {

      columns++;

    }

  }


  const target =
    index +
    direction *
      columns;


  if (
    cards[target]
  ) {

    cards[target].focus();

  } else if (
    direction < 0
  ) {

    getCategories()[0]
      ?.focus();

  }

}


/* =========================================================
   CONTROLE REMOTO / TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  async (event) => {

    const key =
      event.key;


    /*
     * PLAYER ABERTO
     */

    if (
      state.playerOpen
    ) {

      if (
        key === "Escape" ||
        key === "Backspace" ||
        key === "BrowserBack"
      ) {

        event.preventDefault();

        await closePlayer();

        return;

      }


      if (
        key === "Enter" ||
        key === " "
      ) {

        event.preventDefault();

        showPlayerControls();

        await togglePlayPause();

        return;

      }


      if (
        key === "MediaPlayPause"
      ) {

        event.preventDefault();

        await togglePlayPause();

        return;

      }


      if (
        key === "AudioVolumeMute"
      ) {

        event.preventDefault();

        toggleMute();

        return;

      }


      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight"
        ].includes(key)
      ) {

        event.preventDefault();

        showPlayerControls();

        return;

      }


      return;

    }


    /*
     * Inputs.
     */

    const tag =
      document.activeElement
        ?.tagName
        ?.toLowerCase();


    if (
      tag === "input" ||
      tag === "textarea"
    ) {

      if (
        key ===
        "Escape"
      ) {

        document.activeElement
          ?.blur();

      }

      return;

    }


    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter"
      ].includes(key)
    ) {

      event.preventDefault();

    }


    const current =
      document.activeElement;


    const nav =
      getNav();

    const categories =
      getCategories();

    const cards =
      getCards();


    /*
     * ENTER
     */

    if (
      key ===
      "Enter"
    ) {

      if (
        current?.classList
          .contains(
            "nav-btn"
          )
      ) {

        current.click();

        return;

      }


      if (
        current?.classList
          .contains(
            "category-pill"
          )
      ) {

        current.click();

        return;

      }


      if (
        current?.classList
          .contains(
            "movie-card"
          )
      ) {

        current.click();

        return;

      }

    }


    /*
     * DIREITA
     */

    if (
      key ===
      "ArrowRight"
    ) {

      if (
        current?.classList
          .contains(
            "nav-btn"
          )
      ) {

        moveHorizontal(
          nav,
          1
        );

        return;

      }


      if (
        current?.classList
          .contains(
            "category-pill"
          )
      ) {

        moveHorizontal(
          categories,
          1
        );

        return;

      }


      if (
        current?.classList
          .contains(
            "movie-card"
          )
      ) {

        moveHorizontal(
          cards,
          1
        );

        return;

      }

    }


    /*
     * ESQUERDA
     */

    if (
      key ===
      "ArrowLeft"
    ) {

      if (
        current?.classList
          .contains(
            "nav-btn"
          )
      ) {

        moveHorizontal(
          nav,
          -1
        );

        return;

      }


      if (
        current?.classList
          .contains(
            "category-pill"
          )
      ) {

        moveHorizontal(
          categories,
          -1
        );

        return;

      }


      if (
        current?.classList
          .contains(
            "movie-card"
          )
      ) {

        moveHorizontal(
          cards,
          -1
        );

        return;

      }

    }


    /*
     * BAIXO
     */

    if (
      key ===
      "ArrowDown"
    ) {

      if (
        current?.classList
          .contains(
            "nav-btn"
          )
      ) {

        categories[0]
          ?.focus();

        return;

      }


      if (
        current?.classList
          .contains(
            "category-pill"
          )
      ) {

        cards[0]
          ?.focus();

        return;

      }


      if (
        current?.classList
          .contains(
            "movie-card"
          )
      ) {

        moveVerticalCards(
          1
        );

        return;

      }

    }


    /*
     * CIMA
     */

    if (
      key ===
      "ArrowUp"
    ) {

      if (
        current?.classList
          .contains(
            "movie-card"
          )
      ) {

        moveVerticalCards(
          -1
        );

        return;

      }


      if (
        current?.classList
          .contains(
            "category-pill"
          )
      ) {

        nav[0]
          ?.focus();

        return;

      }

    }

  }
);


/* =========================================================
   NAV BUTTONS
========================================================= */

$$(".nav-btn")
  .forEach(
    (button) => {

      button.onclick =
        async () => {

          await selectSection(
            button.dataset.section
          );

        };

    }
  );


/* =========================================================
   BOOT
========================================================= */

async function boot() {

  console.log(
    "[STREAMBOX] Iniciando..."
  );


  setStatus(
    "Iniciando...",
    false
  );


  const account =
    loadAccount();


  if (!account) {

    setStatus(
      "Configure a lista",
      false
    );


    $("#settings")
      ?.showModal();


    return;

  }


  if ($("#server")) {

    $("#server").value =
      account.server || "";

  }


  if ($("#username")) {

    $("#username").value =
      account.username || "";

  }


  if ($("#password")) {

    $("#password").value =
      account.password || "";

  }


  const success =
    await connect(
      true
    );


  if (!success) {

    $("#settings")
      ?.showModal();

  }

}


/* =========================================================
   INICIAR
========================================================= */

boot();