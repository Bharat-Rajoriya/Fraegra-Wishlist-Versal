import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();

app.use(express.json());

app.use(cors({
  origin: [
    "https://fraegra.myshopify.com",
    "https://fraegra.com"
  ],
}));

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.API_VERSION;

/* -----------------------------
   Shopify GraphQL Helper
------------------------------ */
async function shopifyGraphQL(query, variables = {}) {
  const response = await fetch(
    https://${SHOP}/admin/api/${API_VERSION}/graphql.json,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const json = await response.json();

  if (json.errors) {
    console.error(json.errors);
    throw new Error("Shopify request failed");
  }

  return json.data;
}

/* -----------------------------
   Health
------------------------------ */
app.get("/api/health", (req, res) => {
  res.json({ status: "Wishlist server running on Vercel" });
});

app.get("/test-shopify", async (req, res) => {
  const data = await shopifyGraphQL(`
    {
      shop {
        name
      }
    }
  `);

  res.json(data);
});

/* -----------------------------
   Toggle Wishlist
------------------------------ */
app.post("/api/wishlist/toggle/:customerId", async (req, res) => {
  const customerId = decodeURIComponent(req.params.customerId);
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({ error: "productId required" });
  }

  try {
    const data = await shopifyGraphQL(
      `
      query getWishlist($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "custom", key: "wishlist_products") {
            value
          }
        }
      }
      `,
      { id: customerId }
    );

    let wishlist = [];
    const raw = data.customer?.metafield?.value;

    if (raw) {
      try {
        wishlist = JSON.parse(raw);
      } catch {
        wishlist = [];
      }
    }

    const exists = wishlist.includes(productId);

    wishlist = exists
      ? wishlist.filter(id => id !== productId)
      : [...wishlist, productId];

    await shopifyGraphQL(
      `
      mutation updateWishlist($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }
      `,
      {
        input: {
          id: customerId,
          metafields: [
            {
              namespace: "custom",
              key: "wishlist_products",
              type: "list.single_line_text_field",
              value: JSON.stringify(wishlist),
            },
          ],
        },
      }
    );

    res.json({
      success: true,
      action: exists ? "removed" : "added",
      wishlist,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Wishlist update failed" });
  }
});

/* IMPORTANT: Export for Vercel */
export default app;
