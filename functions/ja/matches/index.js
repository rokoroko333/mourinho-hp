// /ja/matches/ with this season's fixtures and results in the HTML (lib/matches-page.js).
import { serveMatchesPage } from '../../../lib/matches-page.js';

export const onRequestGet = serveMatchesPage;
