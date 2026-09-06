"""Reproduce the production login failure: capture exact Clerk error codes."""
import json
from playwright.sync_api import sync_playwright

BASE = 'https://worthit.eu.cc'
EMAIL = 'worthit.prodtest@example.com'
RESULTS = {}
clerk_responses = []

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=[
            # bypass the broken local DNS resolver (returns RFC5737 placeholder IPs)
            '--host-resolver-rules=MAP worthit.eu.cc 216.198.79.1, MAP clerk.worthit.eu.cc 172.64.153.110',
        ],
    )
    page = browser.new_page(viewport={'width': 390, 'height': 844})

    console_logs = []
    page.on('console', lambda m: console_logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: console_logs.append(f'[pageerror] {e}'))

    def on_response(r):
        try:
            u = r.url
            if 'clerk' in u and '/v1/' in u:
                try:
                    body = r.text()[:700]
                except Exception:
                    body = '<body unavailable>'
                clerk_responses.append(f'{r.status} {r.request.method} {u.split("?")[0]}\n    {body}')
        except Exception:
            pass

    page.on('response', on_response)

    page.goto(f'{BASE}/login', wait_until='domcontentloaded')
    page.wait_for_timeout(4000)
    page.screenshot(path='p1_login.png', full_page=True)
    RESULTS['heading'] = page.locator('h1').first.text_content() if page.locator('h1').count() else 'NO H1'

    email_input = page.locator('#email')
    if email_input.count():
        email_input.fill(EMAIL)
        btn = page.get_by_role('button', name='Send 6-digit code →')
        btn.click()
        page.wait_for_timeout(12000)
        page.screenshot(path='p2_after_send.png', full_page=True)
        body = page.locator('body').text_content() or ''
        RESULTS['reached_code_step'] = 'Check your email' in body
        err = page.locator('.bg-bad-bg').first
        RESULTS['visible_error'] = err.text_content().strip() if err.count() else None
    else:
        RESULTS['error'] = 'no email input — page did not render'

    RESULTS['clerk_responses'] = clerk_responses
    RESULTS['console_errors'] = [l for l in console_logs if 'error' in l.lower() or 'Turnstile' in l][:15]
    print(json.dumps(RESULTS, indent=2))
    browser.close()
