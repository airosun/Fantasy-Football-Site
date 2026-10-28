# Too Many Cucks – League Stats

Stats site for an ESPN fantasy football league. Pages: This Week, Previous Matchups, Managers, Over the Season.

## Deploy (no installs needed)
1. Create a new GitHub repo and upload every file in this folder (keep the `public` folder). Do NOT upload your `.env` file.
2. On render.com: New > Web Service > connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. In Render's **Environment** tab, add:
   - `LEAGUE_ID` = 1869959
   - `SEASONS` = 2026   (add past seasons later, e.g. `2024,2025,2026`)
   - `ESPN_S2` = your espn_s2 cookie value
   - `SWID` = your SWID cookie value (including the braces)
4. Deploy. The site refreshes from ESPN every 15 minutes and picks up the new week automatically.

## Notes
- All ESPN-specific code is in `espn.js`; all calculations are in `stats.js`.
- Free Render services sleep when idle, so the first visit after a quiet spell takes about a minute.
- If the ESPN cookies expire (they last a long time, but it happens), update them in Render.
