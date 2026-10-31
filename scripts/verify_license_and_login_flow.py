import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        print("[TEST 1] Visiting http://127.0.0.1:5173/ with empty localStorage...")
        await page.goto("http://127.0.0.1:5173/")
        await page.wait_for_timeout(2000)

        # Clear localStorage to simulate brand new device without license
        await page.evaluate("""() => {
            localStorage.clear();
        }""")
        await page.reload()
        await page.wait_for_timeout(2000)

        content = await page.content()
        # Verify Lockout screen or unlicensed state
        has_lockout = "Subscription Expired" in content or "License Required" in content or "Developer Support" in content
        print(f"  -> License Lockout / Activation displayed: {has_lockout}")
        assert has_lockout, "Expected license lockout screen when unlicensed!"

        # Read sample license for Ramesh Kirana
        with open("/home/killindodo/omnibill/licenses/RAMESH-KIRANA.json", "r") as f:
            ramesh_lic = json.load(f)

        print("[TEST 2] Activating valid license for Ramesh Kirana Store...")
        # Inject license into localStorage as if verified or imported
        await page.evaluate("""(lic) => {
            localStorage.setItem('omnibill_online_license', JSON.stringify({
                ...lic,
                last_verified_ms: Date.now()
            }));
            localStorage.setItem('omnibill_business_profile', JSON.stringify({
                id: lic.tenant_id,
                trade_name: lic.business_name,
                legal_name: lic.business_name,
                gstin: lic.gstin,
                state_code: '27',
                phone: '+91 98200 12345',
                email: 'ramesh@kirana.local',
                address_line1: 'Shop 4, Market Road',
                city: 'Mumbai',
                postal_code: '400001',
                upi_vpa: 'ramesh@upi'
            }));
            localStorage.setItem('omnibill_active_vertical', 'RETAIL');
        }""", ramesh_lic)

        await page.reload()
        await page.wait_for_timeout(2000)

        content = await page.content()

        # Verify Business Name and GSTIN are locked
        has_store_name = "Ramesh Kirana Store" in content
        has_gstin = "27AABCR1234D1Z5" in content
        print(f"  -> Store Name 'Ramesh Kirana Store' visible: {has_store_name}")
        print(f"  -> GSTIN '27AABCR1234D1Z5' visible: {has_gstin}")
        assert has_store_name, "Store name should be Ramesh Kirana Store"
        assert has_gstin, "GSTIN should match license"

        # Verify 4-card business selector is NOT present
        # In the old design, there were 4 cards with descriptions: 'General retail & supermarkets', 'Bulk orders & B2B GST invoicing', 'Fee counter & student uniforms', 'OPD pharmacy & patient billing'
        has_old_picker = "General retail & supermarkets" in content or "Bulk orders & B2B GST invoicing" in content
        print(f"  -> Old 4-Card Business Selector Removed: {not has_old_picker}")
        assert not has_old_picker, "Business picker cards should be completely removed from login!"

        # Verify simplified fields exist: Staff Role, Operator Name, Counter ID, PIN
        has_role_cashier = "Cashier Staff" in content or "Cashier" in content
        has_counter = "Counter" in content or "POS-01" in content
        print(f"  -> Clean staff / counter fields present: {has_role_cashier and has_counter}")

        # Take screenshot of clean single-store login
        screenshot_path = "/home/killindodo/omnibill/scripts/screenshots/clean_login.png"
        os.makedirs(os.path.dirname(screenshot_path), exist_ok=True)
        await page.screenshot(path=screenshot_path)
        print(f"  -> Screenshot saved to {screenshot_path}")

        print("[TEST 3] Testing Expired License Behavior...")
        # Now set an expired license
        expired_lic = dict(ramesh_lic)
        expired_lic["valid_until"] = "2024-01-01"
        expired_lic["valid_until_day"] = 19723 # 2024-01-01 in civil day

        await page.evaluate("""(lic) => {
            localStorage.setItem('omnibill_online_license', JSON.stringify(lic));
        }""", expired_lic)

        await page.reload()
        await page.wait_for_timeout(2000)

        content_expired = await page.content()
        has_expired_banner = "Subscription Expired" in content_expired or "expired" in content_expired.lower()
        has_support_contact = "Developer Support" in content_expired or "+91 98765 43210" in content_expired
        print(f"  -> Screen Locked on Expiry: {has_expired_banner}")
        print(f"  -> Developer Support Contact Shown: {has_support_contact}")
        assert has_expired_banner, "Lockout screen should be active when expired"

        # Take screenshot of lockout screen
        lockout_screenshot_path = "/home/killindodo/omnibill/scripts/screenshots/lockout_screen.png"
        await page.screenshot(path=lockout_screenshot_path)
        print(f"  -> Lockout screenshot saved to {lockout_screenshot_path}")

        print("[ALL TESTS PASSED SUCCESSFULLY!]")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
