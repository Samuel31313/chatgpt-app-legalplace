import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";

// ── Constantes ──────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEGALPLACE_API = "https://clear-api.legalplace.fr/api/v1";
const LP_HEADERS = {
  "Content-Type": "application/json",
  "lp-referrer": "https://www.legalplace.fr/",
  "lp-origin": "https://www.legalplace.fr/projet/creation-sasu-wf",
};

// ── Chargement du widget HTML ───────────────────────────────
const widgetHtml = readFileSync(
  join(__dirname, "..", "public", "checkout-widget.html"),
  "utf8"
);

// ── Helper API LegalPlace ───────────────────────────────────
async function createLegalPlaceInstance(
  slug: string,
  email: string,
  checkoutSlug: string,
  checkoutVersion: string
): Promise<{ uniqid: string; checkoutUrl: string }> {
  const { data } = await axios.post(
    `${LEGALPLACE_API}/wizard/instance/${slug}/`,
    {
      app_type: "wizardx",
      instanceDomain: "www.legalplace.fr",
      draft: 1,
      email: email.trim(),
      metadata: {
        checkout: checkoutVersion,
        checkoutSlug: checkoutSlug,
      },
      ovc: { o: {}, v: {} },
    },
    { headers: LP_HEADERS }
  );

  if (data.status !== "SUCCESS" || !data.uniqid) {
    throw new Error("LegalPlace n'a pas retourné d'identifiant d'instance");
  }

  const encodedEmail = encodeURIComponent(email.trim());
  const checkoutUrl = `https://www.legalplace.fr/creation/checkout/${checkoutSlug}/${checkoutVersion}?email=${encodedEmail}&uniqid=${data.uniqid}&product=${checkoutSlug}`;

  return { uniqid: data.uniqid, checkoutUrl };
}

// ── Fabrique du serveur MCP ─────────────────────────────────
function createMcpServer() {
  const server = new McpServer({
    name: "legalplace-creation",
    version: "1.1.0",
  });

  // Enregistrer le widget checkout
  registerAppResource(
    server,
    "checkout-widget",
    "ui://widget/checkout.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://widget/checkout.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
        },
      ],
    })
  );

  // ── Outil : Aide au choix du statut juridique ─────────────
  registerAppTool(
    server,
    "choix_statut_juridique",
    {
      title: "Choisir son statut juridique",
      description:
        "Analyse la situation de l'utilisateur et recommande le statut juridique le plus adapté (micro-entreprise, EI, EURL, SASU, SARL, SAS). Utilise cet outil quand l'utilisateur hésite sur son statut ou demande de l'aide pour choisir. Pose les questions nécessaires pour comprendre sa situation avant d'appeler cet outil.",
      inputSchema: {
        activite: z.string().describe("Type d'activité envisagée"),
        seul_ou_associes: z
          .enum(["seul", "plusieurs"])
          .describe("L'utilisateur entreprend seul ou avec des associés"),
        chiffre_affaires_estime: z
          .enum(["moins_de_77700", "entre_77700_et_300000", "plus_de_300000"])
          .describe("Tranche de chiffre d'affaires annuel estimé"),
        protection_patrimoine: z
          .boolean()
          .describe("Souhaite protéger son patrimoine personnel"),
        besoin_tva: z
          .boolean()
          .describe("A besoin de récupérer la TVA sur ses achats"),
        charges_importantes: z
          .boolean()
          .describe("A des charges importantes (loyer, matériel, salariés)"),
        levee_de_fonds: z
          .boolean()
          .describe("Prévoit de lever des fonds auprès d'investisseurs"),
        autres_revenus: z
          .string()
          .optional()
          .describe("Autres sources de revenus (salarié, retraité, etc.)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking":
          "Analyse de votre situation en cours...",
        "openai/toolInvocation/invoked":
          "Voici notre recommandation de statut juridique !",
      },
    },
    async (args) => {
      const a = args as any;

      let statut_recommande = "";
      let explication = "";
      let avantages: string[] = [];
      let inconvenients: string[] = [];
      let alternatives: string[] = [];
      let action_suivante = "";

      if (a.seul_ou_associes === "plusieurs") {
        if (a.levee_de_fonds) {
          statut_recommande = "SAS (Société par Actions Simplifiée)";
          explication =
            "Vous êtes plusieurs et prévoyez de lever des fonds : la SAS offre la flexibilité idéale pour accueillir des investisseurs.";
          avantages = [
            "Grande flexibilité dans la rédaction des statuts",
            "Facilité pour faire entrer des investisseurs",
            "Responsabilité limitée aux apports",
            "Pas de capital social minimum",
          ];
          inconvenients = [
            "Charges sociales élevées sur la rémunération du président",
            "Formalisme de création plus lourd",
            "Coûts de fonctionnement plus élevés",
          ];
          alternatives = ["SARL si vous préférez un cadre plus encadré"];
        } else {
          statut_recommande = "SARL (Société à Responsabilité Limitée)";
          explication =
            "Vous êtes plusieurs associés sans besoin de lever des fonds : la SARL offre un cadre juridique sécurisant et bien connu.";
          avantages = [
            "Cadre juridique très encadré et protecteur",
            "Responsabilité limitée aux apports",
            "Régime social du gérant majoritaire avantageux",
            "Idéal pour les activités familiales",
          ];
          inconvenients = [
            "Moins de flexibilité que la SAS",
            "Cession de parts plus contraignante",
          ];
          alternatives = [
            "SAS si vous voulez plus de flexibilité dans les statuts",
          ];
        }
      } else {
        // Seul
        if (
          a.chiffre_affaires_estime === "moins_de_77700" &&
          !a.besoin_tva &&
          !a.charges_importantes &&
          !a.levee_de_fonds
        ) {
          statut_recommande = "Micro-entreprise (auto-entrepreneur)";
          explication =
            "Votre chiffre d'affaires est sous les plafonds, vous n'avez pas de charges importantes et n'avez pas besoin de TVA : la micro-entreprise est le choix le plus simple et économique.";
          avantages = [
            "Création gratuite et immédiate",
            "Comptabilité ultra-simplifiée",
            "Charges sociales proportionnelles au CA",
            "Franchise de TVA",
            "Pas de bilan annuel",
          ];
          inconvenients = [
            "Impossible de déduire les charges réelles",
            "Plafonds de chiffre d'affaires",
            "Pas de récupération de TVA",
          ];
          alternatives = [
            "EI si vous dépassez les plafonds",
            "SASU si vous voulez optimiser votre rémunération",
          ];
          action_suivante = "create_micro_entreprise_checkout";
        } else if (
          a.protection_patrimoine &&
          (a.levee_de_fonds ||
            a.chiffre_affaires_estime === "plus_de_300000")
        ) {
          statut_recommande = "SASU (Société par Actions Simplifiée Unipersonnelle)";
          explication =
            "Vous êtes seul, souhaitez protéger votre patrimoine et avez un CA important ou prévoyez de lever des fonds : la SASU est idéale pour optimiser votre rémunération et accueillir des investisseurs.";
          avantages = [
            "Responsabilité limitée aux apports",
            "Optimisation rémunération/dividendes",
            "Facilité pour faire entrer des investisseurs",
            "Statut social de salarié (meilleure protection)",
            "Crédibilité auprès des partenaires",
          ];
          inconvenients = [
            "Charges sociales plus élevées qu'en EURL",
            "Formalisme de création",
            "Coûts de fonctionnement",
          ];
          alternatives = [
            "EURL si vous n'avez pas besoin d'investisseurs",
          ];
          action_suivante = "create_sasu_checkout";
        } else if (a.protection_patrimoine) {
          statut_recommande = "EURL (Entreprise Unipersonnelle à Responsabilité Limitée)";
          explication =
            "Vous êtes seul et souhaitez protéger votre patrimoine avec un CA moyen : l'EURL offre la protection d'une société avec une gestion simplifiée.";
          avantages = [
            "Responsabilité limitée aux apports",
            "Possibilité d'opter pour l'IS",
            "Régime social TNS (moins cher)",
            "Déduction des charges réelles",
          ];
          inconvenients = [
            "Formalisme de création",
            "Comptabilité complète obligatoire",
          ];
          alternatives = [
            "SASU si vous préférez le statut de salarié",
            "Micro-entreprise si votre CA reste faible",
          ];
        } else if (a.charges_importantes) {
          statut_recommande = "EI (Entreprise Individuelle)";
          explication =
            "Vous êtes seul avec des charges importantes à déduire mais ne ressentez pas le besoin de protéger votre patrimoine via une société : l'EI au régime réel vous permet de déduire vos charges.";
          avantages = [
            "Création simple et rapide",
            "Déduction des charges réelles",
            "Pas de capital social",
            "Comptabilité simplifiée par rapport à une société",
          ];
          inconvenients = [
            "Responsabilité illimitée (patrimoine personnel exposé)",
            "Moins de crédibilité qu'une société",
          ];
          alternatives = [
            "EURL pour protéger votre patrimoine",
            "Micro-entreprise si vos charges restent faibles",
          ];
        } else {
          statut_recommande = "Micro-entreprise (auto-entrepreneur)";
          explication =
            "Au vu de votre situation, la micro-entreprise reste le choix le plus simple pour démarrer. Vous pourrez toujours évoluer vers un autre statut plus tard.";
          avantages = [
            "Création gratuite et immédiate",
            "Comptabilité ultra-simplifiée",
            "Charges sociales proportionnelles au CA",
          ];
          inconvenients = [
            "Plafonds de chiffre d'affaires",
            "Pas de déduction des charges réelles",
          ];
          alternatives = [
            "EI au régime réel si vos charges augmentent",
            "SASU si vous voulez vous verser des dividendes",
          ];
          action_suivante = "create_micro_entreprise_checkout";
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**Statut recommandé : ${statut_recommande}**\n\n${explication}\n\n**Avantages :**\n${avantages.map((a) => `- ${a}`).join("\n")}\n\n**Inconvénients :**\n${inconvenients.map((i) => `- ${i}`).join("\n")}\n\n**Alternatives à considérer :**\n${alternatives.map((a) => `- ${a}`).join("\n")}${action_suivante ? `\n\nSi ce statut vous convient, je peux lancer la création immédiatement via LegalPlace. Il me faudra juste votre email.` : `\n\nPour ce statut, je vous recommande de consulter un expert-comptable pour finaliser votre choix et vous accompagner dans les démarches.`}`,
          },
        ],
        structuredContent: {
          statut_recommande,
          explication,
          avantages,
          inconvenients,
          alternatives,
          action_suivante,
          situation: {
            activite: a.activite,
            seul_ou_associes: a.seul_ou_associes,
            chiffre_affaires_estime: a.chiffre_affaires_estime,
            protection_patrimoine: a.protection_patrimoine,
            besoin_tva: a.besoin_tva,
            charges_importantes: a.charges_importantes,
            levee_de_fonds: a.levee_de_fonds,
          },
        },
      };
    }
  );

  // ── Outil : Créer une micro-entreprise ────────────────────
  registerAppTool(
    server,
    "create_micro_entreprise_checkout",
    {
      title: "Créer une micro-entreprise",
      description:
        "Crée une instance LegalPlace pour la création d'une micro-entreprise et retourne le lien de checkout pour finaliser le paiement. Utilise cet outil quand l'utilisateur veut créer sa micro-entreprise et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        telephone: z.string().optional().describe("Numéro de téléphone"),
        activite: z
          .string()
          .optional()
          .describe("Description de l'activité envisagée"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Création de votre micro-entreprise en cours...",
        "openai/toolInvocation/invoked":
          "Votre lien de checkout est prêt !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'adresse email est requise pour créer votre micro-entreprise.",
            },
          ],
        };
      }

      try {
        const { uniqid, checkoutUrl } = await createLegalPlaceInstance(
          "creez-votre-micro-entreprise",
          email,
          "micro-entrepreneur",
          "packs-v16"
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Votre lien de checkout micro-entreprise est prêt !\n\n👉 ${checkoutUrl}\n\nCliquez sur le lien pour choisir votre pack et finaliser la création de votre micro-entreprise avec LegalPlace.`,
            },
          ],
          structuredContent: {
            type: "micro-entreprise",
            checkout_url: checkoutUrl,
            uniqid,
            email,
            telephone: (args as any).telephone || null,
            activite: (args as any).activite || null,
          },
        };
      } catch (error: any) {
        const errMsg =
          error.response
            ? `LegalPlace (${error.response.status}): ${JSON.stringify(error.response.data)}`
            : error.message;
        return {
          content: [
            {
              type: "text" as const,
              text: `Erreur lors de la création : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  // ── Outil : Créer une SASU ────────────────────────────────
  registerAppTool(
    server,
    "create_sasu_checkout",
    {
      title: "Créer une SASU",
      description:
        "Crée une instance LegalPlace pour la création d'une SASU (Société par Actions Simplifiée Unipersonnelle) et retourne le lien de checkout pour finaliser le paiement. Utilise cet outil quand l'utilisateur veut créer sa SASU et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        telephone: z.string().optional().describe("Numéro de téléphone"),
        nom_societe: z
          .string()
          .optional()
          .describe("Nom souhaité pour la société"),
        activite: z
          .string()
          .optional()
          .describe("Description de l'activité de la SASU"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Création de votre SASU en cours...",
        "openai/toolInvocation/invoked":
          "Votre lien de checkout est prêt !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'adresse email est requise pour créer votre SASU.",
            },
          ],
        };
      }

      try {
        const { uniqid, checkoutUrl } = await createLegalPlaceInstance(
          "creation-sasu",
          email,
          "creation-sasu",
          "packs-v16"
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Votre lien de checkout SASU est prêt !\n\n👉 ${checkoutUrl}\n\nCliquez sur le lien pour choisir votre pack et finaliser la création de votre SASU avec LegalPlace.`,
            },
          ],
          structuredContent: {
            type: "sasu",
            checkout_url: checkoutUrl,
            uniqid,
            email,
            telephone: (args as any).telephone || null,
            nom_societe: (args as any).nom_societe || null,
            activite: (args as any).activite || null,
          },
        };
      } catch (error: any) {
        const errMsg =
          error.response
            ? `LegalPlace (${error.response.status}): ${JSON.stringify(error.response.data)}`
            : error.message;
        return {
          content: [
            {
              type: "text" as const,
              text: `Erreur lors de la création : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

// ── Serveur HTTP ────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("URL manquante");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  // CORS preflight
  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        status: "ok",
        service: "legalplace-creation-app",
        version: "1.1.0",
      })
    );
    return;
  }

  // Point d'entrée MCP
  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // sans état
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Erreur MCP:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Erreur interne du serveur");
      }
    }
    return;
  }

  res.writeHead(404).end("Non trouvé");
});

httpServer.listen(port, () => {
  console.log(`Serveur MCP LegalPlace en écoute sur http://localhost:${port}${MCP_PATH}`);
});
