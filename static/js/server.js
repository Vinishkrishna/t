import express from "express";
import cors from "cors";
import { translate } from "@vitalets/google-translate-api";

const app = express();
app.use(express.json());
app.use(cors());

// MAIN TRANSLATION ROUTE
app.post("/translate", async (req, res) => {
    try {
        const { text, languages } = req.body;

        if (!text || !languages || !Array.isArray(languages)) {
            return res.status(400).json({ error: "text and languages[] required" });
        }

        let results = {};

        for (const lang of languages) {
            try {
                const result = await translate(text, { to: lang });
                results[lang] = result.text;
            } catch (err) {
                results[lang] = `[${lang}] ${text}`; // fallback
            }
        }

        res.json({ success: true, translations: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Translation failed" });
    }
});

app.listen(4000, () => console.log("Server running on port 4000"));
