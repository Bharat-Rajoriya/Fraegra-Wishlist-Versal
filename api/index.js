import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(cors({
  origin: [
    "https://fraegra.myshopify.com",
    "https://fraegra.com"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.API_VERSION;

/* -----------------------------
   Shopify GraphQL Helper
------------------------------ */
async function shopifyGraphQL(query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
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
    console.error("Shopify GraphQL errors:", json.errors);
    throw new Error("Shopify GraphQL request failed");
  }

  return json.data;
}

/* -----------------------------
   Health Check
------------------------------ */
app.get("/health", (req, res) => {
  res.json({ status: "Wishlist server running" });
});

app.get("/test-shopify", async (req, res) => {
  try {
    const data = await shopifyGraphQL(`
      {
        shop {
          name
        }
      }
    `);

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Shopify connection failed" });
  }
});

app.get("/test-customer/:id", async (req, res) => {
  try {
    const customerId = req.params.id;

    const data = await shopifyGraphQL(
      `
      query getCustomer($id: ID!) {
        customer(id: $id) {
          id
          email
          metafield(namespace: "custom", key: "wishlist_products") {
            value
          }
        }
      }
      `,
      { id: customerId }
    );

    res.json(data);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Customer fetch failed" });
  }
});

/* -----------------------------
   Get Wishlist
------------------------------ */
app.get("/wishlist/:customerId", async (req, res) => {
  const customerId = decodeURIComponent(req.params.customerId);

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

    const raw = data.customer?.metafield?.value;
    const wishlist = raw ? JSON.parse(raw) : [];

    res.json({ wishlist });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch wishlist" });
  }
});

/* -----------------------------
   Toggle Wishlist
------------------------------ */
app.post("/wishlist/toggle/:customerId", async (req, res) => {
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

export default app;