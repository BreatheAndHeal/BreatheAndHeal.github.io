const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("service switch is balanced and accessible", () => {
  const home = read("index.html");
  assert.ok(home.includes('role="tablist" aria-label="Choose a service"'));
  assert.ok(home.includes('id="emotionalTab" role="tab" aria-selected="true" aria-controls="emotionalPanel"'));
  assert.ok(home.includes('id="astrologyTab" role="tab" aria-selected="false" aria-controls="astrologyPanel"'));
  assert.ok(home.includes(".service-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))"));
  assert.ok(home.includes(".service-switch button{display:flex;align-items:center;justify-content:center;width:100%;min-width:0;min-height:44px"));
});

test("before-payment guidance is a native disclosure and is collapsed by default in markup", () => {
  const home = read("index.html");
  assert.ok(home.includes('<details class="before-pay" id="beforePay" aria-labelledby="beforePayTitle">'));
  assert.ok(!home.includes('<details class="before-pay" id="beforePay" aria-labelledby="beforePayTitle" open>'));
  assert.ok(home.includes('<summary class="before-pay-summary">'));
  assert.ok(home.includes('const beforePay=document.getElementById("beforePay");'));
  assert.ok(home.includes('if(beforePay) beforePay.open=false;'));
  assert.ok(home.includes("Avoid paying twice."));
});

test("order summary uses readable mobile rows and keeps total in the heading row", () => {
  const home = read("index.html");
  assert.ok(home.includes(".order-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 12px;padding-top:8px}"));
  assert.ok(home.includes(".order-summary-grid div:first-child{grid-column:1/-1}"));
  assert.ok(home.includes(".order-summary-grid div:last-child{position:absolute;top:12px;right:12px;display:flex;align-items:center;justify-content:flex-end"));
  assert.ok(home.includes("overflow-wrap:normal;word-break:normal;hyphens:none"));
  assert.ok(home.includes('data-summary="emotional-session"'));
  assert.ok(home.includes('data-summary="astrology-total"'));
});

test("switching service keeps vertical scroll and resets accidental horizontal scroll", () => {
  const home = read("index.html");
  assert.ok(home.includes("const scrollPosition=window.scrollY;"));
  assert.ok(home.includes('x.setAttribute("aria-selected","false")'));
  assert.ok(home.includes('tab.setAttribute("aria-selected","true")'));
  assert.ok(home.includes("window.scrollTo({left:0,top:scrollPosition"));
  assert.ok(home.includes("#book{overflow-anchor:none}"));
});

test("booking fields cannot widen the mobile layout through intrinsic widths", () => {
  const home = read("index.html");
  assert.ok(home.includes("#book, #book>.wrap, #book .book, #book .book-panel, #book .booking-panel,"));
  assert.ok(home.includes("#book form, #book .form-row, #book .field, #book .order-summary{min-width:0;max-width:100%}"));
  assert.ok(home.includes("#book .form-row{grid-template-columns:repeat(2,minmax(0,1fr))}"));
  assert.ok(home.includes("#book .field input, #book .field select, #book .field textarea{display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box}"));
  assert.ok(home.includes("#book .form-row{grid-template-columns:minmax(0,1fr)}"));
  assert.ok(home.includes("window.scrollTo({left:0,top:scrollPosition,behavior:\"auto\"})"));
});

test("mobile WhatsApp button is compact without changing contact target or accessible label", () => {
  const widget = read("whatsapp-widget.js");
  assert.ok(widget.includes('link.href = "https://wa.me/918707236175?text=Hi%20The%20Unsaid%2C%20I%20want%20to%20know%20more"'));
  assert.ok(widget.includes('link.setAttribute("aria-label", label + ". For general enquiries and booking questions.")'));
  assert.ok(widget.includes("width: 46px;"));
  assert.ok(widget.includes("height: 46px;"));
  assert.ok(widget.includes("border-radius: 50%;"));
  assert.ok(widget.includes("clip: rect(0, 0, 0, 0);"));
});

test("guide cards are visibly named and provide a touch and keyboard popup effect", () => {
  const home = read("index.html");
  const guideStart = home.indexOf('<section class="soft" id="guide">');
  const guideEnd = home.indexOf('<section class="soft" id="faq">', guideStart);
  const guide = home.slice(guideStart, guideEnd);
  assert.ok(guide.includes("aria-label=\"Highlight Utkarsh's guide profile\""));
  assert.ok(guide.includes("aria-label=\"Highlight Anshika's guide profile\""));
  assert.equal((guide.match(/tabindex="0" role="button" aria-pressed="false"/g) || []).length, 2);
  assert.ok(guide.includes("<h3>Utkarsh</h3>"));
  assert.ok(guide.includes("<h3>Anshika</h3>"));
  assert.ok(home.includes(".guide-person:hover,.guide-person:focus-visible,.guide-person.is-active{transform:translateY(-4px)"));
  assert.ok(home.includes('card.addEventListener("click",toggleGuideCard)'));
  assert.ok(home.includes('if((event.key==="Enter"||event.key===" ")&&!event.repeat)'));
});

test("Before You Pay starts collapsed across desktop and mobile", () => {
  const home = read("index.html");
  assert.ok(home.includes('<details class="before-pay" id="beforePay" aria-labelledby="beforePayTitle">'));
  assert.ok(!home.includes('<details class="before-pay" id="beforePay" aria-labelledby="beforePayTitle" open>'));
  assert.ok(home.includes('if(beforePay) beforePay.open=false;'));
  assert.ok(!home.includes('beforePay.open=!window.matchMedia("(max-width:560px)").matches;'));
});

test("Before You Book FAQ rows match the checkout accordion interaction", () => {
  const home = read("index.html");
  assert.ok(home.includes(".faq summary{display:flex;align-items:center;justify-content:space-between;gap:14px;cursor:pointer;font-weight:600;list-style:none}"));
  assert.ok(home.includes('.faq summary::after{content:"⌄";display:grid;place-items:center;flex:0 0 28px'));
  assert.ok(home.includes(".faq details[open] summary::after{transform:rotate(180deg)}"));
  assert.ok(home.includes("@media(hover:hover){.faq details:hover{transform:translateY(-3px)"));
  assert.ok(home.includes("@media(hover:none){.faq details:active{transform:scale(.995)"));
  assert.ok(home.includes('document.querySelectorAll(".faq details > summary").forEach(summary=>{'));
  assert.ok(home.includes('if(item) item.open=!item.open;'));
});

test("Before You Book is a single collapsed card that reveals independently expandable FAQ answers", () => {
  const home = read("index.html");
  const faqStart = home.indexOf('<section class="soft" id="faq">');
  const faqEnd = home.indexOf("</section>", faqStart);
  const faqSection = home.slice(faqStart, faqEnd);
  assert.ok(faqSection.includes('<details class="faq-disclosure" id="faqDisclosure">'));
  assert.ok(!faqSection.includes('<details class="faq-disclosure" id="faqDisclosure" open>'));
  assert.ok(faqSection.includes('<summary class="faq-disclosure-summary">'));
  assert.ok(faqSection.includes("<h2 class=\"section-title\">Before you book.</h2>"));
  assert.ok(faqSection.includes('<div class="faq-disclosure-content"><div class="faq">'));
  assert.equal((faqSection.match(/<details><summary>/g) || []).length, 8);
  assert.ok(home.includes("@media(hover:hover){.faq-disclosure-summary:hover{transform:translateY(-3px)"));
  assert.ok(home.includes("@media(hover:none){.faq-disclosure-summary:active{transform:scale(.995)"));
  assert.ok(home.includes('document.querySelectorAll(".faq details > summary").forEach(summary=>{'));
});
