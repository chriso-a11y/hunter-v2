import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const COOKIES_PATH =
  process.env.INDEED_COOKIES_PATH ||
  path.join(process.cwd(), 'data', 'indeed-session.json');

export interface IndeedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

function loadCookies(): IndeedCookie[] {
  // Try env var first (Railway deployment)
  if (process.env.INDEED_SESSION_COOKIES) {
    try {
      return JSON.parse(process.env.INDEED_SESSION_COOKIES) as IndeedCookie[];
    } catch {
      console.error('[Indeed] Failed to parse INDEED_SESSION_COOKIES env var');
    }
  }
  // Fall back to file
  if (fs.existsSync(COOKIES_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8')) as IndeedCookie[];
    } catch {
      console.error('[Indeed] Failed to parse cookies file at', COOKIES_PATH);
    }
  }
  return [];
}

export function saveCookies(cookies: IndeedCookie[]): void {
  const dir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

async function getContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const rawCookies = loadCookies();
  if (rawCookies.length > 0) {
    const playwrightCookies = rawCookies
      .filter((c) => c.value && c.value.length > 0)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path: c.path || '/',
        secure: true,
        httpOnly: false,
        sameSite: 'None' as const,
      }));
    await context.addCookies(playwrightCookies);
  }

  return context;
}

/**
 * Given an Indeed application URL, navigate to the page and extract the resume text.
 */
export async function fetchIndeedResume(applicationUrl: string): Promise<string> {
  const context = await getContext();
  const page = await context.newPage();

  try {
    await page.goto(applicationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check if we've been redirected to login
    if (
      page.url().includes('accounts.indeed.com') ||
      page.url().includes('secure.indeed.com')
    ) {
      console.error('[Indeed] Session expired or invalid — redirected to login');
      await page.close();
      await context.close();
      return '';
    }

    // Wait for resume content to load
    await page.waitForTimeout(2000);

    const resumeSelectors = [
      '[data-testid="resume-container"]',
      '[data-tn-element="resume"]',
      '.resume-container',
      '#resume',
      '[class*="resume"]',
      '.applicant-resume',
      '[data-testid="applicantResume"]',
    ];

    let resumeText = '';
    for (const selector of resumeSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          resumeText = await el.innerText();
          if (resumeText.length > 50) break;
        }
      } catch {
        continue;
      }
    }

    // Fallback: main content area
    if (!resumeText || resumeText.length < 50) {
      try {
        resumeText = await page.locator('main').first().innerText({ timeout: 3000 });
      } catch {
        resumeText = await page.evaluate<string>('document.body.innerText');
      }
    }

    await page.close();
    await context.close();
    return resumeText.trim();
  } catch (err) {
    console.error('[Indeed] fetchIndeedResume error:', err);
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    return '';
  }
}

/**
 * Extract an application URL from an Indeed notification email body.
 * Indeed emails contain links like:
 *   https://employers.indeed.com/hire/apply?applicationKey=xxx
 *   https://employers.indeed.com/manage/applicants/view?applicationId=xxx
 */
export function extractApplicationUrl(emailBody: string): string | null {
  const patterns = [
    /https:\/\/employers\.indeed\.com\/[^\s"<>]+(?:applicationKey|applicationId|apply)[^\s"<>]*/gi,
    /https:\/\/employers\.indeed\.com\/hire\/[^\s"<>]+/gi,
    /https:\/\/employers\.indeed\.com\/manage\/applicants\/[^\s"<>]+/gi,
  ];

  for (const pattern of patterns) {
    const matches = emailBody.match(pattern);
    if (matches && matches[0]) {
      return matches[0].replace(/[.,;!?)]+$/, '');
    }
  }
  return null;
}

/**
 * Close the browser singleton — call during graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
