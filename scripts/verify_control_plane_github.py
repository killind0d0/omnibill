import asyncio
import os
from playwright.async_api import async_playwright

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1366, 'height': 850})
        page = await context.new_page()

        print("[STEP 1] Navigating to Control Plane at http://127.0.0.1:8090/...")
        await page.goto("http://127.0.0.1:8090/")
        await page.wait_for_timeout(1000)

        # Check if already logged in or needs login
        content = await page.content()
        if "Sign in with Super Admin credentials" in content or "placeholder=\"e.g. admin\"" in content:
            print("  Logging in as admin...")
            await page.fill('input[placeholder*="admin"]', 'admin')
            await page.fill('input[type="password"]', 'Admin@OmniBill2026!')
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(2000)

        print("[STEP 2] Verifying Super Admin Dashboard & Businesses List...")
        await page.wait_for_selector('text=Provision Business', timeout=8000)

        # Take screenshot of businesses list with GitHub & JSON download buttons
        os.makedirs("/home/killindodo/omnibill/scripts/screenshots", exist_ok=True)
        await page.screenshot(path="/home/killindodo/omnibill/scripts/screenshots/superadmin_businesses_list.png")
        print("  -> Screenshot saved to superadmin_businesses_list.png")

        print("[STEP 3] Verifying Settings Screen with GitHub Automation Panel...")
        settings_nav = page.locator('button:has-text("Settings"), a:has-text("Settings")')
        if await settings_nav.count() > 0:
            await settings_nav.first.click()
            await page.wait_for_timeout(1000)
            settings_content = await page.content()
            has_github_panel = "GitHub Automation & Cloud Sync" in settings_content or "killind0d0/omnibill-licenses" in settings_content
            print(f"  -> GitHub Automation Panel visible: {has_github_panel}")
            assert has_github_panel, "GitHub Automation panel must be in Settings!"
            await page.screenshot(path="/home/killindodo/omnibill/scripts/screenshots/settings_github_panel.png")
            print("  -> Screenshot saved to settings_github_panel.png")

        print("[STEP 4] Verifying Provision Business Modal & Handover Screen...")
        # Navigate back to businesses
        biz_nav = page.locator('button:has-text("Businesses"), a:has-text("Businesses")')
        if await biz_nav.count() > 0:
            await biz_nav.first.click()
            await page.wait_for_timeout(1000)

        # Click "+ Provision Business"
        await page.click('button:has-text("Provision Business")')
        await page.wait_for_timeout(800)

        # Fill in business form with unique test name
        unique_id = int(asyncio.get_event_loop().time())
        biz_test_name = f"Automated Store {unique_id}"
        name_input = page.locator('input[placeholder*="Apex Supermarket"]')
        await name_input.fill(biz_test_name)
        
        # Click Provision Tenant
        gen_btn = page.locator('button[type="submit"]:has-text("Provision Tenant")')
        await gen_btn.click()
        await page.wait_for_timeout(2500)

        # Check handover content
        modal_content = await page.content()
        has_handover = "Handover Card" in modal_content or biz_test_name in modal_content
        print(f"  -> Handover modal generated: {has_handover}")
        assert has_handover, "Handover modal should show business details!"

        has_download_json = "Download license.json" in modal_content or ".json" in modal_content
        has_github_status = "GitHub" in modal_content or "Push to GitHub" in modal_content
        print(f"  -> 'Download license.json' button visible: {has_download_json}")
        print(f"  -> GitHub sync controls visible: {has_github_status}")
        assert has_download_json, "Download license.json button must be visible in Handover modal!"

        await page.screenshot(path="/home/killindodo/omnibill/scripts/screenshots/provisioning_handover_modal.png")
        print("  -> Screenshot saved to provisioning_handover_modal.png")

        print("\n[VERIFICATION COMPLETE] All elements verified successfully!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_verification())
