import express from "express";
import cors from "cors";
import compression from "compression";
import { Readable } from "node:stream";

const app = express();

const PORT = process.env.PORT || 8080;
const appOrigin = process.env.APP_ORIGIN || "*";

// Log de depuração desligado por padrão — o proxy de stream é chamado a cada
// segmento de vídeo (dezenas de vezes por minuto), então logar sempre pesa
// desnecessariamente. Ative com a variável de ambiente DEBUG=true no Render
// se precisar investigar algo.
const DEBUG = process.env.DEBUG === "true";
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

app.use(
  cors({
    origin: appOrigin === "*" ? true : appOrigin
  })
);

app.use(
  compression({
    filter: (req, res) => {

      if (
        req.path.startsWith("/proxy/")
      ) {
        return false;
      }

      return compression.filter(
        req,
        res
      );

    }
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(express.static("public", {
  dotfiles: "allow",
  // index.html precisa ser sempre revalidado (pode mudar); os demais arquivos
  // (css, js, ícones) ganham cache de 1 dia no navegador, reduzindo downloads
  // repetidos sem risco de servir algo desatualizado por muito tempo.
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));


/* =========================================================
   UTILIDADES
========================================================= */

function cleanServer(server) {
  return String(server || "")
    .trim()
    .replace(/\/+$/, "");
}


function credentials(req) {
  const server = cleanServer(
    req.body?.server || req.query?.server
  );

  const username = String(
    req.body?.username ||
    req.query?.username ||
    ""
  ).trim();

  const password = String(
    req.body?.password ||
    req.query?.password ||
    ""
  );

  if (
    !/^https?:\/\//i.test(server) ||
    !username ||
    !password
  ) {
    const error = new Error(
      "Servidor, usuário e senha são obrigatórios."
    );

    error.status = 400;

    throw error;
  }

  return {
    server,
    username,
    password
  };
}


/* =========================================================
   XTREAM API
========================================================= */

async function xtream(
  req,
  action = "",
  extraParams = {}
) {
  const {
    server,
    username,
    password
  } = credentials(req);

  const url = new URL(
    `${server}/player_api.php`
  );

  url.searchParams.set(
    "username",
    username
  );

  url.searchParams.set(
    "password",
    password
  );

  if (action) {
    url.searchParams.set(
      "action",
      action
    );
  }

  for (
    const [key, value]
    of Object.entries(extraParams)
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  }

  const response = await fetch(
    url,
    {
      redirect: "follow"
    }
  );

  if (!response.ok) {
    const error = new Error(
      `Servidor IPTV respondeu HTTP ${response.status}`
    );

    error.status = 502;

    throw error;
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(
      "Resposta do servidor IPTV não é JSON válido."
    );

    error.status = 502;

    throw error;
  }
}


/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "StreamBox IPTV backend"
    });
  }
);


/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const data = await xtream(req);

      if (
        data?.user_info?.status &&
        data.user_info.status
          .toLowerCase() !== "active"
      ) {
        return res
          .status(401)
          .json({
            error:
              "Conta IPTV não está ativa."
          });
      }

      res.json({
        ok: true,
        user_info:
          data?.user_info || {}
      });

    } catch (error) {
      res
        .status(error.status || 500)
        .json({
          error: error.message
        });
    }
  }
);


/* =========================================================
   CATEGORIAS
========================================================= */

app.post(
  "/api/categories",
  async (req, res) => {
    try {
      const [
        live,
        vod,
        series
      ] = await Promise.all([
        xtream(
          req,
          "get_live_categories"
        ),

        xtream(
          req,
          "get_vod_categories"
        ),

        xtream(
          req,
          "get_series_categories"
        ).catch(() => [])
      ]);

      res.json({
        live:
          Array.isArray(live)
            ? live
            : [],

        vod:
          Array.isArray(vod)
            ? vod
            : [],

        series:
          Array.isArray(series)
            ? series
            : []
      });

    } catch (error) {
      res
        .status(error.status || 500)
        .json({
          error: error.message
        });
    }
  }
);


/* =========================================================
   NORMALIZAÇÃO DE NOMES
========================================================= */

function normalizeName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[²³]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   SISTEMA DE CANAIS PRINCIPAIS
========================================================= */

/*
 * O sistema NÃO depende do nome exato.
 *
 * Exemplo:
 *
 * "SBT SP FHD"
 * "SBT SP HD"
 * "SBT SP SD"
 *
 * todos podem ser encontrados através
 * da mesma regra.
 */

const PRINCIPAIS = [

  {
    titulo: "Globo",
    palavras: [
      ["rede globo sp", "globo sp"],
      ["globo sp"]
    ]
  },

  {
    titulo: "SBT",
    palavras: [
      ["sbt sp"],
      ["sbt"]
    ]
  },

  {
    titulo: "Band",
    palavras: [
      ["band sp"],
      ["band"]
    ]
  },

  {
    titulo: "Record",
    palavras: [
      ["record sp"],
      ["record tv sp"],
      ["record"]
    ]
  },

  {
    titulo: "ESPN",
    palavras: [
      ["espn"]
    ]
  },

  {
    titulo: "SporTV",
    palavras: [
      ["sportv"]
    ]
  },

  {
    titulo: "Premiere",
    palavras: [
      ["premiere clubes"],
      ["premiere 1"],
      ["premiere"]
    ]
  },

  {
    titulo: "DAZN",
    palavras: [
      ["dazn"]
    ]
  },

  {
    titulo: "TNT Sports",
    palavras: [
      ["tnt sports 01"],
      ["tnt sports"]
    ]
  },

  {
    titulo: "Globo News",
    palavras: [
      ["globo news"]
    ]
  },

  {
    titulo: "CNN Brasil",
    palavras: [
      ["cnn brasil"]
    ]
  },

  {
    titulo: "Band News",
    palavras: [
      ["band news"]
    ]
  },

  {
    titulo: "Record News",
    palavras: [
      ["record news"]
    ]
  },

  {
    titulo: "TNT",
    palavras: [
      ["tnt"]
    ]
  },

  {
    titulo: "HBO",
    palavras: [
      ["hbo fhd"],
      ["hbo hd"],
      ["hbo"]
    ]
  },

  {
    titulo: "Discovery",
    palavras: [
      ["discovery channel"]
    ]
  },

  {
    titulo: "History",
    palavras: [
      ["the history"],
      ["history"]
    ]
  },

  {
    titulo: "Cartoon Network",
    palavras: [
      ["cartoon network"]
    ]
  },

  {
    titulo: "Nickelodeon",
    palavras: [
      ["nick fhd"],
      ["nick hd"],
      ["nickelodeon"]
    ]
  }
];


/* =========================================================
   QUALIDADE DO CANAL
========================================================= */

function qualityScore(name) {

  const n = normalizeName(name);

  if (n.includes("4k"))
    return 100;

  if (n.includes("fhd"))
    return 90;

  if (n.includes("full hd"))
    return 90;

  if (n.includes("uhd"))
    return 85;

  if (n.includes("hd"))
    return 70;

  if (n.includes("sd"))
    return 30;

  return 50;
}


/* =========================================================
   ENCONTRAR CANAL PRINCIPAL
========================================================= */

function findBestChannel(
  channels,
  regras
) {

  const candidatos = [];

  for (const channel of channels) {

    const nome = normalizeName(
      channel.name
    );

    for (
      let i = 0;
      i < regras.length;
      i++
    ) {

      const regra = normalizeName(
        regras[i][0]
      );

      if (
        nome === regra ||
        nome.includes(regra)
      ) {

        let score =
          1000 -
          (i * 100);

        score += qualityScore(
          channel.name
        );

        /*
         * Evita versões SD quando
         * existe FHD/HD.
         */

        if (
          nome.includes("sd")
        ) {
          score -= 200;
        }

        /*
         * Evita canais internacionais
         * quando estamos procurando
         * canais brasileiros.
         */

        if (
          nome.includes("internacional")
        ) {
          score -= 100;
        }

        candidatos.push({
          channel,
          score
        });

        break;
      }
    }
  }

  candidatos.sort(
    (a, b) =>
      b.score - a.score
  );

  return candidatos[0]?.channel || null;
}


/* =========================================================
   ITENS
========================================================= */

app.post(
  "/api/items",
  async (req, res) => {

    try {

      const type =
        req.body?.type;

      const categoryId =
        req.body?.categoryId;


      if (
        ![
          "live",
          "vod",
          "series"
        ].includes(type)
      ) {

        return res
          .status(400)
          .json({
            error:
              "Tipo inválido."
          });

      }


      /* =====================================================
         TV PRINCIPAIS
      ===================================================== */

      if (
        type === "live" &&
        String(categoryId) === "principal"
      ) {

        debugLog(
          "[TV PRINCIPAIS] Buscando canais..."
        );


        const data =
          await xtream(
            req,
            "get_live_streams"
          );


        const channels =
          Array.isArray(data)
            ? data
            : [];


        debugLog(
          `[TV PRINCIPAIS] ${channels.length} canais encontrados`
        );


        const resultado = [];


        for (
          const grupo
          of PRINCIPAIS
        ) {

          const canal =
            findBestChannel(
              channels,
              grupo.palavras
            );


          if (canal) {

            resultado.push(
              canal
            );

            debugLog(
              `[PRINCIPAL] ${grupo.titulo} -> ${canal.name}`
            );

          } else {

            debugLog(
              `[PRINCIPAL] ${grupo.titulo} -> NÃO ENCONTRADO`
            );

          }
        }


        debugLog(
          `[TV PRINCIPAIS] ${resultado.length} canais selecionados`
        );


        return res.json(
          resultado
        );
      }


      /* =====================================================
         DEMAIS CATEGORIAS
      ===================================================== */

      const action =
        type === "live"
          ? "get_live_streams"
          : type === "vod"
            ? "get_vod_streams"
            : "get_series";


      const data =
        await xtream(
          req,
          action
        );


      const arr =
        Array.isArray(data)
          ? data
          : [];


      const filtered =
        categoryId
          ? arr.filter(
              x =>
                String(
                  x.category_id
                ) ===
                String(
                  categoryId
                )
            )
          : arr;


      res.json(
        filtered
      );


    } catch (error) {

      console.error(
        "[ITEMS ERROR]",
        error
      );

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message
        });

    }
  }
);

/* =========================================================
   INFORMAÇÕES DA SÉRIE
   Temporadas + episódios
========================================================= */

app.post(
  "/api/series/info",
  async (req, res) => {

    try {

      const seriesId =
        req.body?.seriesId;

      if (!seriesId) {

        return res
          .status(400)
          .json({
            error:
              "seriesId é obrigatório."
          });

      }

      const data =
        await xtream(
          req,
          "get_series_info",
          {
            series_id:
              seriesId
          }
        );

      res.json(
        data || {}
      );

    } catch (error) {

      console.error(
        "[SERIES INFO ERROR]",
        error
      );

      res
        .status(
          error.status || 500
        )
        .json({
          error:
            error.message
        });

    }

  }
);
/* =========================================================
   PROXY DE STREAM / VOD
========================================================= */
/* =========================================================
   PROXY DE STREAM / VOD
========================================================= */

/* =========================================================
   PROXY HLS / STREAM
========================================================= */

app.get("/proxy/stream", async (req, res) => {

  try {

    const server = cleanServer(req.query.server);
    const path = String(req.query.path || "");

    debugLog("[PROXY] Requisição recebida");
    debugLog("[PROXY] Server:", server);
    debugLog("[PROXY] Path:", path);

    if (
      !/^https?:\/\//i.test(server) ||
      !path.startsWith("/")
    ) {

      console.error("[PROXY] Parâmetros inválidos");

      return res
        .status(400)
        .send("Parâmetros inválidos");

    }


    const target =
      new URL(path, server).toString();


    debugLog("[PROXY] Target:", target);


    const headers = {

      "User-Agent":
        "VLC/3.0.20 LibVLC/3.0.20",

      "Accept":
        "*/*",

      "Connection":
        "keep-alive"

    };


    if (req.headers.range) {

      headers.Range =
        req.headers.range;

      debugLog(
        "[PROXY] Range:",
        req.headers.range
      );

    }


    const upstream =
      await fetch(
        target,
        {
          method: "GET",

          headers,

          redirect: "follow"
        }
      );


    debugLog(
      "[PROXY] Resposta IPTV:",
      upstream.status,
      upstream.statusText
    );


    if (
      !upstream.ok &&
      upstream.status !== 206
    ) {

      return res
        .status(upstream.status)
        .send(
          `IPTV respondeu HTTP ${upstream.status}`
        );

    }


    /*
     * =====================================================
     * HLS PLAYLIST
     *
     * Se for .m3u8, precisamos devolver a playlist
     * reescrevendo os links para passarem pelo proxy.
     * =====================================================
     */

    const contentType =
      (
        upstream.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();


    const isM3U8 =
      path
        .toLowerCase()
        .includes(".m3u8") ||
      contentType.includes(
        "mpegurl"
      ) ||
      contentType.includes(
        "m3u8"
      );


    if (isM3U8) {

      debugLog(
        "[PROXY] Playlist HLS detectada"
      );


      const playlist =
        await upstream.text();


      /*
       * Base da playlist.
       *
       * Normalmente o IPTV retorna:
       *
       * #EXTINF...
       * segmento.ts
       *
       * ou:
       *
       * http://servidor/live/.../segmento.ts
       */


      const playlistLines =
        playlist.split(/\r?\n/);


      const rewritten =
        playlistLines.map(
          line => {

            const value =
              line.trim();


            /*
             * Linha vazia
             */

            if (!value) {

              return line;

            }


            /*
             * Comentários HLS
             */

            if (
              value.startsWith("#")
            ) {

              /*
               * Alguns HLS possuem
               * URI="..."
               *
               * dentro de tags.
               */

              return line.replace(
                /URI="([^"]+)"/gi,
                (_, uri) => {

                  try {

                    const absolute =
                      new URL(
                        uri,
                        target
                      ).toString();


                    const u =
                      new URL(
                        absolute
                      );


                    return `URI="${createProxyUrl(
                      server,
                      u.pathname +
                      u.search
                    )}"`;

                  } catch {

                    return `URI="${uri}"`;

                  }

                }
              );

            }


            /*
             * Segmento ou sub-playlist.
             */

            try {

              const absolute =
                new URL(
                  value,
                  target
                );


              return createProxyUrl(
                server,
                absolute.pathname +
                absolute.search
              );

            } catch {

              return line;

            }

          }
        )
        .join("\n");


      res.status(200);


      res.setHeader(
        "Content-Type",
        "application/vnd.apple.mpegurl"
      );


      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
      );


      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );


      return res.send(
        rewritten
      );

    }


    /*
     * =====================================================
     * STREAM NORMAL
     * =====================================================
     */

    res.status(
      upstream.status
    );


    const upstreamContentType =
      upstream.headers.get(
        "content-type"
      );


    if (upstreamContentType) {

      res.setHeader(
        "Content-Type",
        upstreamContentType
      );

    }


    const contentLength =
      upstream.headers.get(
        "content-length"
      );


    if (contentLength) {

      res.setHeader(
        "Content-Length",
        contentLength
      );

    }


    const contentRange =
      upstream.headers.get(
        "content-range"
      );


    if (contentRange) {

      res.setHeader(
        "Content-Range",
        contentRange
      );

    }


    res.setHeader(
      "Accept-Ranges",
      "bytes"
    );


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );


    if (upstream.body) {

      Readable
        .fromWeb(upstream.body)
        .pipe(res);

    } else {

      res.end();

    }


  } catch (error) {

    console.error(
      "[PROXY ERROR]",
      error
    );


    if (
      !res.headersSent
    ) {

      res
        .status(502)
        .send(
          "Falha ao acessar o stream IPTV"
        );

    } else {

      res.end();

    }

  }

});


/* =========================================================
   CRIA URL DO PROXY
========================================================= */

function createProxyUrl(
  server,
  path
) {

  return (
    "/proxy/stream" +
    "?server=" +
    encodeURIComponent(server) +
    "&path=" +
    encodeURIComponent(path)
  );

}

/* =========================================================
   START
========================================================= */

/* =========================================================
   START DO SERVIDOR
========================================================= */

app.listen(PORT, () => {
  console.log(`StreamBox TV backend rodando na porta ${PORT}`);
});

export { app };