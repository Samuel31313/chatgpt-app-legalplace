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

// ââ Constants ââââââââââââââââââââââââââââââââââââââââââââââ
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEGALPLACE_API = "https://clear-api.legalplace.fr/api/v1";
const LP_HEADERS = {
  "Content-Type": "application/json",
  "lp-referrer": "https://www.legalplace.fr/",
  "lp-origin": "https://www.legalplace.fr/projet/creation-sasu-wf",
};

// ââ Load widget HTML âââââââââââââââââââââââââââââââââââââââ
const widgetHtml = readFileSync(
  join(__dirname, "..", "public", "checkout-widget.html"),
  "utf8"
);

// ââ LegalPlace API helper ââââââââââââââââââââââââââââââââââ
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
    throw new Error("LegalPlace did not return an instance ID");
  }

  const encodedEmail = encodeURIComponent(email.trim());
  const checkoutUrl = `https://www.legalplace.fr/creation/checkout/${checkoutSlug}/${checkoutVersion}?email=${encodedEmail}&uniqid=${data.uniqid}&product=${checkoutSlug}`;

  return { uniqid: data.uniqid, checkoutUrl };
}

// ââ MCP Server factory âââââââââââââââââââââââââââââââââââââ
function createMcpServer() {
  const server = new McpServer({
    name: "legalplace-creation",
    version: "1.0.0",
  });

  // Register the checkout widget resource
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

  // ââ Tool: Create Micro-Entreprise Checkout âââââââââââââââ
  registerAppTool(
    server,
    "create_micro_entreprise_checkout",
    {
      title: "Creer micro-entreprise",
      description:
        "Cree une instance LegalPlace pour la creation d'une micro-entreprise et retourne le lien de checkout. Utilise cet outil quand l'utilisateur veut creer sa micro-entreprise et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        phone: z.string().optional().describe("Numero de telephone"),
        activity: z
          .string()
          .optional()
          .describe("Description de l'activite"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Creation de votre micro-entreprise en cours...",
        "openai/toolInvocation/invoked":
          "Votre lien de checkout est pret !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'email est requis pour creer votre micro-entreprise.",
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
              text: `Votre lien de checkout micro-entreprise est pret : ${checkoutUrl}`,
            },
          ],
          structuredContent: {
            type: "micro-entreprise",
            checkout_url: checkoutUrl,
            uniqid,
            email,
            phone: (args as any).phone || null,
            activity: (args as any).activity || null,
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
              text: `Erreur lors de la creation : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  // ââ Tool: Create SASU Checkout âââââââââââââââââââââââââââ
  registerAppTool(
    server,
    "create_sasu_checkout",
    {
      title: "Creer SASU",
      description:
        "Cree une instance LegalPlace pour la creation d'une SASU et retourne le lien de checkout. Utilise cet outil quand l'utilisateur veut creer sa SASU et a fourni son email.",
      inputSchema: {
        email: z.string().email().describe("Adresse email de l'utilisateur"),
        phone: z.string().optional().describe("Numero de telephone"),
        company_name: z
          .string()
          .optional()
          .describe("Nom de la societe"),
        activity: z
          .string()
          .optional()
          .describe("Description de l'activite"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        ui: { resourceUri: "ui://widget/checkout.html" },
        "openai/toolInvocation/invoking":
          "Creation de votre SASU en cours...",
        "openai/toolInvocation/invoked": "Votre lien de checkout est pret !",
      },
    },
    async (args) => {
      const email = (args as any).email?.trim();
      if (!email) {
        return {
          content: [
            {
              type: "text" as const,
              text: "L'email est requis pour creer votre SASU.",
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
              text: `Votre lien de checkout SASU est pret : ${checkoutUrl}`,
            },
          ],
          structuredContent: {
            type: "sasu",
            checkout_url: checkoutUrl,
            uniqid,
            email,
            phone: (args as any).phone || null,
            company_name: (args as any).company_name || null,
            activity: (args as any).activity || null,
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
              text: `Erreur lors de la creation : ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

// ââ HTTP Server ââââââââââââââââââââââââââââââââââââââââââââ
const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
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
        version: "1.0.0",
      })
    );
    return;
  }

  // MCP endpoint
  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
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
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(`LegalPlace MCP server listening on http://localhost:${port}${MCP_PATH}`);
});
