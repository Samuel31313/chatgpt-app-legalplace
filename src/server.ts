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

// ‚îÄ‚îÄ Constantes ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEGALPLACE_API = "https://clear-api.legalplace.fr/api/v1";
const LP_HEADERS = {
  "Content-Type": "application/json",
  "lp-referrer": "https://www.legalplace.fr/",
  "lp-origin": "https://www.legalplace.fr/projet/creation-sasu-wf",
};

// ‚îÄ‚îÄ Chargement du widget HTML ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
const widgetHtml = readFileSync(
  join(__dirname, "..", "public", "checkout-widget.html"),
  "utf8"
);

// ‚îÄ‚îÄ Helper API LegalPlace ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
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
    throw new Error("LegalPlace n'a pas retourn√© d'identifiant d'instance");
  }

  const encodedEmail = encodeURIComponent(email.trim());
  const checkoutUrl = `https://www.legalplace.fr/creation/checkout/${checkoutSlug}/${checkoutVersion}?email=${encodedEmail}&uniqid=${data.uniqid}&product=${checkoutSlug}`;

  return { uniqid: data.uniqid, checkoutUrl };
}

// ‚îÄ‚îÄ Fabrique du serveur MCP ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
function createMcpServer() {
  const server = new McpServer({
    name: "legalplace-creation",
    version: "1.2.0",
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

  // ‚îÄ‚îÄ Outil : Bienvenue / Menu principal ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
  registerAppTool(
    server,
    "bienvenue",
    {
      title: "LegalPlace - Accueil",
      description:
        "Affiche le menu principal LegalPlace avec les 3 options : cr√©er une micro-entreprise, cr√©er une SASU, ou se faire aider pour choisir son statut juridique. Utilise cet outil d√®s que l'utilisateur mentionne LegalPlace ou veut cr√©er son entreprise sans pr√©ciser le statut.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Chargement de LegalPlace...",
        "openai/toolInvocation/invoked":
          "Bienvenue sur LegalPlace !",
      },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: "Bienvenue sur LegalPlace ! Choisissez l'une des 3 options ci-dessous pour commencer.",
        },
      ],
      structuredContent: {
        type: "bienvenue",
      },
    })
  );

  // ‚îÄ‚îÄ Outil : Aide au choix du statut juridique ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
  registerAppTool(
    server,
    "choix_statut_juridique",
    {
      title: "Choisir son statut juridique",
      description:
        "Analyse la situation de l'utilisateur et recommande le statut juridique le plus adapt√© (micro-entreprise, EI, EURL, SASU, SARL, SAS). Utilise cet outil quand l'utilisateur h√©site sur son statut ou demande de l'aide pour choisir. Pose les questions n√©cessaires pour comprendre sa situation avant d'appeler cet outil.",
      inputSchema: {
        activite: z.string().describe("Type d'activit√© envisag√©e"),
        seul_ou_associes: z
          .enum(["seul", "plusieurs"])
          .describe("L'utilisateur entreprend seul ou avec des associ√©s"),
        chiffre_affaires_estime: z
          .enum(["moins_de_77700", "entre_77700_et_300000", "plus_de_300000"])
          .describe("Tranche de chiffre d'affaires annuel estim√©"),
        protection_patrimoine: z
          .boolean()
          .describe("Souhaite prot√©ger son patrimoine personnel"),
        besoin_tva: z
          .boolean()
          .describe("A besoin de r√©cup√©rer la TVA sur ses achats"),
        charges_importantes: z
          .boolean()
          .describe("A des charges importantes (loyer, mat√©riel, salari√©s)"),
        levee_de_fonds: z
          .boolean()
          .describe("Pr√©voit de lever des fonds aupr√®s d'investisseurs"),
        autres_revenus: z
          .string()
          .optional()
          .describe("Autres sources de revenus (salari√©, retrait√©, etc.)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
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
          statut_recommande = "SAS (Soci√©t√© par Actions Simplifi√©e)";
          explication =
            "Vous √™tes plusieurs et pr√©voyez de lever des fonds : la SAS offre la flexibilit√© id√©ale pour accueillir des investisseurs.";
          avantages = [
            "Grande flexibilit√© dans la r√©daction des statuts",
            "Facilit√© pour faire entrer des investisseurs",
            "Responsabilit√© limit√©e aux apports",
            "Pas de capital social minimum",
          ];
          inconvenients = [
            "Charges sociales √©lev√©es sur la r√©mun√©ration du pr√©sident",
            "Formalisme de cr√©ation plus lourd",
            "Co√ªts de fonctionnement plus √©lev√©s",
          ];
          alternatives = ["SARL si vous pr√©f√©rez un cadre plus encadr√©"];
        } else {
          statut_recommande = "SARL (Soci√©t√© √† Responsabilit√© Limit√©e)";
          explication =
            "Vous √™tes plusieurs associ√©s sans besoin de lever des fonds : la SARL offre un cadre juridique s√©curisant et bien connu.";
          avantages = [
            "Cadre juridique tr√®s encadr√© et protecteur",
            "Responsabilit√© limit√©e aux apports",
            "R√©gime social du g√©rant majoritaire avantageux",
            "Id√©al pour les activit√©s familiales",
          ];
          inconvenients = [
            "Moins de flexibilit√© que la SAS",
            "Cession de parts plus contraignante",
          ];
          alternatives = [
            "SAS si vous voulez plus de flexibilit√© dans les statuts",
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
            "Votre chiffre d'affaires est sous les plafonds, vous n'avez pas de charges importantes et n'avez pas besoin de TVA : la micro-entreprise est le choix le plus simple et √©conomique.";
          avantages = [
            "Cr√©ation gratuite et imm√©diate",
            "Comptabilit√© ultra-simplifi√©e",
            "Charges sociales proportionnelles au CA",
            "Franchise de TVA",
            "Pas de bilan annuel",
          ];
          inconvenients = [
            "Impossible de d√©duire les charges r√©elles",
            "Plafonds de chiffre d'affaires",
            "Pas de r√©cup√©ration de TVA",
          ];
          alternatives = [
            "EI si vous d√©passez les plafonds",
            "SASU si vous voulez optimiser votre r√©mun√©ration",
          ];
          action_suivante = "create_micro_entreprise_checkout";
        } else if (
          a.protection_patrimoine &&
          (a.levee_de_fonds ||
            a.chiffre_affaires_estime === "plus_de_300000")
        ) {
          statut_recommande = "SASU (Soci√©t√© par Actions Simplifi√©e Unipersonnelle)";
          explication =
            "Vous √™tes seul, souhaitez prot√©ger votre patrimoine et avez un CA important ou pr√©voyez de lever des fonds : la SASU est id√©ale pour optimiser votre r√©mun√©ration et accueillir des investisseurs.";
          avantages = [
            "Responsabilit√© limit√©e aux apports",
            "Optimisation r√©mun√©ration/dividendes",
            "Facilit√© pour faire entrer des investisseurs",
            "Statut social de salari√© (meilleure protection)",
            "Cr√©dibilit√© aupr√®s des partenaires",
          ];
          inconvenients = [
            "Charges sociales plus √©lev√©es qu'en EURL",
            "Formalisme de cr√©ation",
            "Co√ªts de fonctionnement",
          ];
          alternatives = [
            "EURL si vous n'avez pas besoin d'investisseurs",
          ];
          action_suivante = "create_sasu_checkout";
        } else if (a.protection_patrimoine) {
          statut_recommande = "EURL (Entreprise Unipersonnelle √† Responsabilit√© Limit√©e)";
          explication =
            "Vous √™tes seul et souhaitez prot√©ger votre patrimoine avec un CA moyen : l'EURL offre la protection d'une soci√©t√© avec une gestion simplifi√©e.";
          avantages = [
            "Responsabilit√© limit√©e aux apports",
            "Possibilit√© d'opter pour l'IS",
            "R√©gime social TNS (moins cher)",
            "D√©duction des charges r√©elles",
          ];
          inconvenients = [
            "Formalisme de cr√©ation",
            "Comptabilit√© compl√®te obligatoire",
          ];
          alternatives = [
            "SASU si vous pr√©f√©rez le statut de salari√©",
            "Micro-entreprise si votre CA reste faible",
          ];
        } else if (a.charges_importantes) {
          statut_recommande = "EI (Entreprise Individuelle)";
          explication =
            "Vous √™tes seul avec des charges importantes √† d√©duire mais ne ressentez pas le besoin de prot√©ger votre patrimoine via une soci√©t√© : l'EI au r√©gime r√©el vous permet de d√©duire vos charges.";
          avantages = [
            "Cr√©ation simple et rapide",
            "D√©duction des charges r√©elles",
            "Pas de capital social",
            "Comptabilit√© simplifi√©e par rapport √† une soci√©t√©",
          ];
          inconvenients = [
            "Responsabilit√© illimit√©e (patrimoine personnel expos√©)",
            "Moins de cr√©dibilit√© qu'une soci√©t√©",
          ];
          alternatives = [
            "EURL pour prot√©ger votre patrimoine",
            "Micro-entreprise si vos charges restent faibles",
          ];
        } else {
          statut_recommande = "Micro-entreprise (auto-entrepreneur)";
          explication =
            "Au vu de votre situation, la micro-entreprise reste le choix le plus simple pour d√©marrer. Vous pourrez toujours √©voluer vers un autre statut plus tard.";
          avantages = [
            "Cr√©ation gratuite et imm√©diate",
            "Comptabilit√© ultra-simplifi√©e",
            "Charges sociales proportionnelles au CA",
          ];
          inconvenients = [
            "Plafonds de chiffre d'affaires",
            "Pas de d√©duction des charges r√©elles",
          ];
          alternatives = [
            "EI au r√©gime r√©el si vos charges augmentent",
            "SASU si vous voulez vous verser des dividendes",
          ];
          action_suivante = "create_micro_entreprise_checkout";
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**Statut recommand√© : ${statut_recommande}**\n\n${explication}\n\n**Avantages :**\n${avantages.map((a) => `- ${a}`).join("\n")}\n\n**Inconv√©nients :**\n${inconvenients.map((i) => `- ${i}`).join("\n")}\n\n**Alternatives √† consid√©rer :**\n${alternatives.map((a) => `- ${a}`).join("\n")}${action_suivante ? `\n\nSi ce statut vous convient, je peux lancer la cr√©ation imm√©diatement via LegalPlace. Il me faudra juste votre email.` : `\n\nPour ce statut, je vous recommande de consulter un expert-comptable pour finaliser votre choix et vous accompagner dans les d√©marches.`}`,
          },
        ],
        structuredContent: {
          type: "statut",
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

  // ‚îÄ‚îÄ Outil : Cr√©er une micro-entreprise ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
  registerAppTool(
    server,
    "create_micro_entreprise_checkout",
    {
      title: "Cr√©er une micro-entreprise",
      description:
        "Cr√©e une instance LegalPlace pour la cr√©ation d'une micro-entreprise et retourne le lien de checkout pour finaliser le paiement. Utilise cet outil quand l'utilisateur veut cr√©er sa micro-entreprise et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        telephone: z.string().optional().describe("Num√©ro de t√©l√©phone"),
        activite: z
          .string()
          .optional()
          .describe("Description de l'activit√© envisag√©e"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Cr√©ation de votre micro-entreprise en cours...",
        "openai/toolInvocation/invoked":
          "Votre lien de checkout est pr√™t !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'adresse email est requise pour cr√©er votre micro-entreprise.",
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
              text: `Votre lien de checkout micro-entreprise est pr√™t !\n\nüëâ ${checkoutUrl}\n\nCliquez sur le lien pour choisir votre pack et finaliser la cr√©ation de votre micro-entreprise avec LegalPlace.`,
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
              text: `Erreur lors de la cr√©ation : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  // ‚îÄ‚îÄ Outil : Cr√©er une SASU ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
  registerAppTool(
    server,
    "create_sasu_checkout",
    {
      title: "Cr√©er une SASU",
      description:
        "Cr√©e une instance LegalPlace pour la cr√©ation d'une SASU (Soci√©t√© par Actions Simplifi√©e Unipersonnelle) et retourne le lien de checkout pour finaliser le paiement. Utilise cet outil quand l'utilisateur veut cr√©er sa SASU et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        telephone: z.string().optional().describe("Num√©ro de t√©l√©phone"),
        nom_societe: z
          .string()
          .optional()
          .describe("Nom souhait√© pour la soci√©t√©"),
        activite: z
          .string()
          .optional()
          .describe("Description de l'activit√© de la SASU"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Cr√©ation de votre SASU en cours...",
        "openai/toolInvocation/invoked":
          "Votre lien de checkout est pr√™t !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'adresse email est requise pour cr√©er votre SASU.",
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
              text: `Votre lien de checkout SASU est pr√™t !\n\nüëâ ${checkoutUrl}\n\nCliquez sur le lien pour choisir votre pack et finaliser la cr√©ation de votre SASU avec LegalPlace.`,
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
              text: `Erreur lors de la cr√©ation : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

// ‚îÄ‚îÄ Serveur HTTP ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
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
        version: "1.2.0",
      })
    );
    return;
  }

  // Point d'entr√©e MCP
  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // sans √©tat
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

  res.writeHead(404).end("Non trouv√©");
});

httpServer.listen(port, () => {
  console.log(`Serveur MCP LegalPlace en √©coute sur http://localhost:${port}${MCP_PATH}`);
});
