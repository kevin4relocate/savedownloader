# Production deployment repair — 2026-09-27

## Confirmed by the automated live audit

GitHub run 36273379718 checked the Cloudflare-served production domain. It returned HTTP 200 on existing pages and healthy API responses but **the deployed JS/CSS byte hashes did not match the then-current main branch**. The new `/instagram-carousel-zip-guide/` returned 404, and `/sitemap.xml` did not match main. The production API health reported Cloudflare deployment/version ID `1282cf7c-5dc2-4ffa-85f8-302228714638`.

The Cloudflare GitHub check for commit `96233b53a1d21a16333e4da314b401e0cf2ec1e2` succeeded and reported Worker version `057cbdb7-4a06-47bc-9816-d38fadc5afff`. A *successful build* and a version URL are **not proof that the custom production domain serves that version**.

Vercel's first-party CORS negative test and both backend health checks passed; do not change Vercel unless a new test indicates a separate problem.

## Most likely explanations to discriminate (do NOT assume which one)

1. Cloudflare Workers Builds **Deploy command** might use `npx wrangler versions upload`, which creates a version without promoting it. Check Workers & Pages > savedownloader > Settings > Build/Builds > production Deploy command. The normal command for this repository's root `wrangler.jsonc` is **`npx wrangler deploy`**; do not use the Preview command for production.
2. **Production branch** could be other than `main` or the root directory could be wrong. Confirm repo `kevin4relocate/savedownloader`, branch `main`, root repository directory, latest commit `96233b53...`.
3. The custom domain `savedownloader.com` may be connected to a different Worker, route or older deployment. In Workers & Pages, open `savedownloader` > Settings > Domains & Routes. Verify the custom domain points to the expected Worker. If traffic uses a route/proxy, inspect route precedence and associated Worker. **Do not delete or reassign a domain blindly**; confirm the currently active binding first.
4. A staged / gradual rollout may leave the older version active. Inspect production Deployments/Versions and active traffic allocation before promoting.

## Safe repair in Cloudflare Dashboard

1. Visit Workers & Pages and select **savedownloader**. Check production deploy history, the production branch and the Deploy command.
2. If builds are upload-only, set Deploy command to `npx wrangler deploy`, and confirm root path is the repository root containing `wrangler.jsonc` and `public/`.
3. Confirm the custom domain is routed to this same Worker. Preserve existing bindings, secrets, DNS and routes; do not create a second Worker with the same hostname.
4. Promote/deploy the verified `main` build; do not promote an unrelated historical version merely because it exists.
5. Run the **Production Deployment Audit** manually from GitHub Actions *after* deploying, or run `node scripts/production-audit.mjs` from a current checkout on a runner that can reach production. It checks exact static asset hashes, the new page, sitemap and non-destructive negative API responses.
6. Run the existing **Production Smoke Test** only with authorized stable test posts. Instagram positive tests require the optional `INSTAGRAM_TEST_URL` repo variable. Complete real iPhone Safari and Android Chrome acceptance separately.

## Release gate / expected results

- `https://savedownloader.com/instagram-carousel-zip-guide/` returns HTTP 200 with the correct canonical and text describing the 64 MB ZIP cap.
- `https://savedownloader.com/assets/app.js`, `tiktok.js`, `instagram.js`, `styles.css`, `nav.css` and `media-gallery.css` match repository hashes after disabling/refreshing caches as appropriate. Verify via the audit, not merely by a 200 status.
- Production `sitemap.xml` exactly matches the current repository version, includes the ZIP guide and accurately dated entries.
- Existing three downloader endpoints, analytics consent and security headers remain functional.
- Audit has zero failures. **Warnings remain** until successful authorized media fixtures and real mobile device tests have separately been completed.

## Avoid a false fix

Do not claim the issue is a Cloudflare cache alone without checking the active Worker and deploy command. Do not purge caches or update DNS as a first step: purging an unchanged old deployment can never publish missing assets. Do not create a second Cloudflare deployment workflow with new API tokens until confirming the existing connected Workers Builds pipeline cannot be repaired.

## Official docs

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
