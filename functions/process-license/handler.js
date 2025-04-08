const fetch = require("node-fetch");

const delay = ms => new Promise(res => setTimeout(res, ms));
const MAX_RETRIES = 6;
const DELAY_MS = 30000;

const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN;
const SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;
const SHOPIFY_ADMIN_API_VERSION = "2023-10";

exports.handler = async function(event, context) {
  try {
    const body = JSON.parse(event.body);
    const orderId = body.order_id;

    if (!orderId) {
      return {
        statusCode: 400,
        body: "Missing order_id"
      };
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/orders/${orderId}/metafields.json`, {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        console.error("Failed to fetch metafields:", await res.text());
        return {
          statusCode: res.status,
          body: "Error fetching metafields from Shopify"
        };
      }

      const json = await res.json();
      const licenseMeta = json.metafields.find(mf => mf.namespace === "xchange" && mf.key === "licenses");

      if (licenseMeta && licenseMeta.value) {
        let html = "";

        try {
          const data = JSON.parse(licenseMeta.value);
          if (Array.isArray(data)) {
            html += "<table border='1' cellpadding='5' cellspacing='0'><thead><tr><th>Product</th><th>Serial</th><th>Download</th></tr></thead><tbody>";
            data.forEach(item => {
              html += `<tr>
                <td>${item.product}</td>
                <td>${item.serial}</td>
                <td><a href="${item.download}" target="_blank">Download</a></td>
              </tr>`;
            });
            html += "</tbody></table>";
          } else {
            return {
              statusCode: 500,
              body: "Expected an array in JSON metafield"
            };
          }
        } catch (err) {
          console.error("JSON parsing error:", err);
          return {
            statusCode: 500,
            body: "Invalid JSON format in metafield"
          };
        }

        const saveRes = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/metafields.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            metafield: {
              namespace: "xchange",
              key: "licenses_html",
              type: "multi_line_text_field",
              value: html,
              owner_id: orderId,
              owner_resource: "order"
            }
          })
        });

        if (!saveRes.ok) {
          console.error("Failed to save HTML metafield:", await saveRes.text());
          return {
            statusCode: 500,
            body: "Failed to save HTML metafield"
          };
        }

        return {
          statusCode: 200,
          body: "HTML saved successfully."
        };
      }

      console.log(`Attempt ${attempt + 1}: licenses metafield not found, retrying...`);
      await delay(DELAY_MS);
    }

    return {
      statusCode: 404,
      body: "License metafield not found after retries."
    };

  } catch (err) {
    console.error("Unexpected error:", err);
    return {
      statusCode: 500,
      body: "Unexpected server error"
    };
  }
};
