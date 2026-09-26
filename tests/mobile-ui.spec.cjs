const { test, expect, devices } = require('@playwright/test');

const BASE = process.env.MOBILE_BASE_URL || 'http://127.0.0.1:8787';
const tikTok = 'https://www.tiktok.com/@fixture/video/1234567890123456789';
const douyin = 'https://www.douyin.com/video/1234567890123456789';
const instagram = 'https://www.instagram.com/p/FixtureABC123/';
const media = 'https://cdninstagram.com/mock-image.jpg';
const media2 = 'https://cdninstagram.com/mock-image-2.jpg';
const tinyJPEG = Buffer.from([0xff,0xd8,0xff,0xd9]);
const tinyVideo = Buffer.from([0,0,0,24,102,116,121,112,109,112,52,50,0,0,0,0,109,112,52,50,105,115,111,109]);

async function mockResolve(page) {
  await page.route('**/api/resolve', async route => {
    const body = route.request().postDataJSON() || {};
    const url = body.url || '';
    const data = url.includes('instagram.com')
      ? {platform:'instagram',id:'FixtureABC123',sourceUrl:instagram,title:'Public fixture',author:'fixture',type:'carousel',media:[{type:'image',url:media},{type:'image',url:media2}]}
      : url.includes('douyin.com')
        ? {platform:'douyin',id:'1234567890123456789',sourceUrl:douyin,title:'Public fixture',author:'fixture',videoUrl:'https://douyin.com/mock-video.mp4'}
        : {platform:'tiktok',id:'1234567890123456789',sourceUrl:tikTok,title:'Public fixture',author:'fixture',videoUrl:'https://tiktokcdn.com/mock-video.mp4'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})});
  });
}
async function clearConsent(page){
  // Test layout with the banner intentionally visible. No analytics cookies are accepted.
  await page.evaluate(()=>localStorage.removeItem('sd_analytics_consent_v1'));
}
async function checkViewport(page){
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth + 2);
  expect(overflow,'mobile horizontal overflow').toBe(false);
}
async function mediaRoutes(page){
  await page.route('**/api/download/instagram?**', async route=>{
    await route.fulfill({status:200,headers:{'content-type':'image/jpeg','content-length':String(tinyJPEG.length),'content-disposition':'attachment; filename="fixture.jpg"'},body:tinyJPEG});
  });
  await page.route('**/api/download/douyin?**',async route=>{
    await route.fulfill({status:200,headers:{'content-type':'video/mp4','content-length':String(tinyVideo.length)},body:tinyVideo});
  });
  await page.route('https://savedownloader-tiktok-api.vercel.app/api/download?**',async route=>{
    await route.fulfill({status:200,headers:{'content-type':'video/mp4','content-length':String(tinyVideo.length),'access-control-allow-origin':'*'},body:tinyVideo});
  });
}

for(const [name,device,browserName] of [
  ['iPhone Safari WebKit emulation',devices['iPhone 13'],'webkit'],
  ['Android Chrome Chromium emulation',devices['Pixel 7'],'chromium']
]){
  test.describe(name,()=>{
    test.use({...device,browserName,acceptDownloads:true});
    test('navigation, form, consent banner and no horizontal scrolling',async({page})=>{
      await page.goto(BASE);
      await clearConsent(page);
      await page.reload();
      await expect(page.locator('[data-consent-banner]')).toBeVisible();
      await checkViewport(page);
      await page.locator('.nav-toggle').click();
      await expect(page.locator('.navlinks')).toHaveClass(/is-open/);
      await page.locator('.nav-toggle').click();
      await expect(page.locator('.navlinks')).not.toHaveClass(/is-open/);
      for(const path of ['/instagram-downloader/','/douyin-downloader/','/tiktok-downloader/','/guides/']){
        await page.goto(BASE+path);
        await checkViewport(page);
        await expect(page.locator('h1')).toBeVisible();
      }
    });
    test('Instagram gallery and ZIP handoff',async({page})=>{
      await mockResolve(page);
      await mediaRoutes(page);
      await page.goto(BASE+'/instagram-downloader/');
      await clearConsent(page);
      await page.locator('input[name="url"]').fill(instagram);
      await page.locator('[data-instagram-downloader-form] button[type="submit"]').click();
      await expect(page.locator('.media-card')).toHaveCount(2);
      await checkViewport(page);
      await page.locator('[data-download-all]').click();
      if(name.startsWith('iPhone')){
        await expect(page.locator('.media-progress .media-save-link')).toBeVisible();
        await expect(page.locator('.media-progress')).toContainText('Tap Save file');
      }else{
        await expect(page.locator('.media-progress')).toContainText('ZIP prepared');
      }
    });
    test('TikTok download action reports handoff correctly',async({page})=>{
      await mockResolve(page);
      await mediaRoutes(page);
      await page.goto(BASE+'/tiktok-downloader/');
      await page.locator('input[name="url"]').fill(tikTok);
      await page.locator('form button[type="submit"]').click();
      await expect(page.locator('[data-actions] button')).toBeVisible();
      await page.locator('[data-actions] button').click();
      if(name.startsWith('iPhone'))await expect(page.locator('.status .mobile-save-link')).toBeVisible();
      else await expect(page.locator('.status')).toContainText('File handed');
      await checkViewport(page);
    });
    test('invalid link shows readable resolver failure',async({page})=>{
      await page.route('**/api/resolve',async route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({ok:false,error:'Unsupported link. Paste a valid public post.'})}));
      await page.goto(BASE+'/instagram-downloader/');
      await page.locator('input[name="url"]').fill('https://www.instagram.com/p/FixtureABC123/');
      await page.locator('form button[type="submit"]').click();
      await expect(page.locator('[data-status].error')).toContainText('Unsupported link');
      await checkViewport(page);
    });
  });
}
