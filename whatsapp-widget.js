(() => {
  const link = document.createElement("a");
  link.id = "the-unsaid-whatsapp-float";
  link.href = "https://wa.me/918707236175?text=Hi%20The%20Unsaid%2C%20I%20want%20to%20know%20more";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const isSafetyPage = /(?:^|\/)crisis(?:\.html)?\/?$/i.test(window.location.pathname);
  const label = isSafetyPage ? "General enquiries on WhatsApp" : "Chat on WhatsApp";
  link.setAttribute("aria-label", label + ". For general enquiries and booking questions.");
  link.title = "Contact The Unsaid for general enquiries and booking questions.";
  link.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none"><path d="M20.52 3.48A11.84 11.84 0 0 0 12.09 0C5.57 0 .26 5.3.25 11.83c0 2.08.55 4.11 1.59 5.9L.15 24l6.43-1.69a11.9 11.9 0 0 0 5.5 1.4h.01c6.52 0 11.83-5.3 11.84-11.82a11.77 11.77 0 0 0-3.41-8.41Z" stroke="currentColor" stroke-width="1.3"/><path d="M8.9 6.7c-.2-.46-.4-.47-.6-.48h-.51c-.18 0-.47.07-.72.34s-.95.92-.95 2.24.97 2.6 1.1 2.78 1.87 3 4.62 4.09c2.28.9 2.75.72 3.25.67.5-.05 1.62-.66 1.85-1.3.23-.64.23-1.19.16-1.3-.07-.12-.25-.19-.53-.33-.27-.14-1.61-.8-1.86-.9-.25-.1-.43-.14-.61.14-.18.27-.7.9-.86 1.08-.16.18-.32.2-.6.07-.27-.14-1.16-.43-2.2-1.35-.82-.73-1.37-1.63-1.53-1.9-.16-.28-.02-.43.12-.57.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.6-1.48-.82-2.02Z" fill="currentColor"/></svg><span></span>';
  link.querySelector("span").textContent = label;

  const style = document.createElement("style");
  style.textContent = `
    #the-unsaid-whatsapp-float {
      position: fixed;
      right: 22px;
      bottom: 22px;
      z-index: 9999;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      max-width: calc(100vw - 28px);
      padding: 13px 17px;
      border: 1px solid rgba(255,255,255,.22);
      border-radius: 999px;
      background: #27312b;
      color: #fff;
      box-shadow: 0 8px 28px rgba(39,49,43,.22);
      font: 600 14px/1.2 "DM Sans", Arial, sans-serif;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
      transition: background .18s ease, transform .18s ease, box-shadow .18s ease;
    }
    #the-unsaid-whatsapp-float:hover {
      background: #526957;
      color: #fff;
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(39,49,43,.25);
    }
    #the-unsaid-whatsapp-float:focus-visible {
      outline: 3px solid #91a993;
      outline-offset: 3px;
    }
    #the-unsaid-whatsapp-float svg { flex: 0 0 20px; }
    @media (max-width: 560px) {
      #the-unsaid-whatsapp-float {
        right: 14px;
        bottom: 14px;
        padding: 12px 14px;
        gap: 8px;
        font-size: 13px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #the-unsaid-whatsapp-float { transition: none; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(link);
})();