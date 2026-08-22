# Trading Journal

Personal trading journal for stocks and bitcoin: log trades with notes and setup tags,
track open positions, and see win rate, profit factor, R-multiples, drawdown, an equity
curve, and P&L per setup. Node.js + Express + Postgres, built to run on Railway.

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. On railway.com: **New Project → Deploy from GitHub repo**, select the repo.
3. In the project, **Create → Database → PostgreSQL**.
4. Open your app service → **Variables → Add Variable Reference** → pick `DATABASE_URL`
   from the Postgres service. (Optionally add `APP_PASSWORD` to gate the site.)
5. App service → **Settings → Networking → Generate Domain**. Open the URL — done.

The `trades` table is created automatically on first start.

## Run locally

```
npm install
DATABASE_URL=postgresql://user:pass@localhost:5432/trading_journal npm start
```

## Features

Dashboard (KPI strip, PNL/drawdown/table, expectancy & risk, results by day and hour),
Trades (log/edit/star/CSV export), Equity Graph, monthly P&L Calendar, Full Scan account
health card, Chart Lab (P&L distribution, performance by time, streaks & rolling
expectancy) and a Chartbook where each trade can carry a chart screenshot (stored in
Postgres, compressed in the browser before upload).

## API

- `GET    /api/trades?asset_type=&style=&setup=&symbol=`
- `POST   /api/trades`
- `PUT    /api/trades/:id`
- `DELETE /api/trades/:id`
- `GET    /api/trades/:id` (includes screenshot)
- `PATCH  /api/trades/:id` (star, screenshot, notes, setup)

Leave `exit_price` empty for an open trade; fill it in when you close.
`risk` (dollars at your stop) is optional and enables R-multiple stats.
