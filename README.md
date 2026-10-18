# A mi naptárunk – Vercel + Neon

Teljesen magyar nyelvű, sötét témájú, telefonközpontú közös naptár. Frontend: React + Vite. Backend: Vercel Functions. Adatbázis: Neon PostgreSQL.

## Telepítés

### 1. Neon adatbázis
1. Nyisd meg a https://console.neon.tech oldalt és válaszd ki a projektedet (vagy hozz létre újat).
2. Nyisd meg az SQL Editor-t.
3. Másold be és futtasd a `neon_schema.sql` fájl teljes tartalmát.

### 2. GitHub
Töltsd fel a projekt összes fájlját egy GitHub repository gyökerébe. Legyen ott a `package.json`, `vercel.json`, `api/`, `src/` és `neon_schema.sql`.

### 3. Vercel
1. Nyisd meg a https://vercel.com/new oldalt, és importáld a GitHub repository-t.
2. A build beállítások: `npm run build`, output: `dist`, install: `npm install`.
3. A **Environment Variables** résznél add meg:
   - `DATABASE_URL`: a Neon Console által adott teljes connection string, SSL-lel (`sslmode=require`).
   - `AUTH_SECRET`: egy hosszú, véletlenszerű titok, például legalább 32 véletlen karakter.
4. Kattints a Deploy gombra.

A `DATABASE_URL` csak a Vercel szerveroldali függvényeiben használatos. Soha ne nevezd át `VITE_DATABASE_URL`-re, és ne tedd közzé GitHubon.

### 4. Használat
Nyisd meg a Vercel URL-t, regisztráljatok külön e-mail-címmel és jelszóval. Egyikőtök hozzon létre közös naptárat, a másik csatlakozzon a meghívókóddal.

## Biztonság és korlátok
- A jelszavakat bcrypt hash formában tároljuk; a bejelentkezést HttpOnly, Secure cookie és aláírt token kezeli.
- Ez az induló verzió egy közös naptárhoz készült; a meghívókódos csatlakozás legfeljebb két tagot enged.
- A jelenlegi felület esemény-CRUD-ot támogat. Az ismétlődési és emlékeztető mező elmentődik, de az automatikus ismétlődés és tényleges értesítések még nincsenek implementálva.
- Éles használat előtt teszteld a regisztrációt, bejelentkezést, naptárlétrehozást és események szerkesztését.
