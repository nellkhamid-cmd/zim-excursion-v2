/* =========================================================================
   Карта района — компонент скилла brand-map, адаптированный под ЗИМ Галерею.
   Подложка — статичный SVG из OpenStreetMap (assets/img/map.svg, © участники OSM),
   метки — HTML поверх по координатам viewBox. Без сторонних API и ключей.

   BrandMap.init(el, {
     list: ".location__legend [data-key]",  // легенда: элементы с тем же data-key, что у меток
     interval: 3400,                        // автопереключение объектов, мс (0 — выключить)
     curve: 0.22                            // изгиб дуги от ЖК до объекта
   });

   · метки и подписи ставятся как при object-fit: cover; подписи мест у краёв
     и поверх меток прячутся; подпись метки уходит на другую сторону, если не помещается;
   · при появлении — раскрытие кругом от ЖК, улица прочерчивается, метки появляются по очереди;
   · метка или пункт легенды — дуга от ЖК до объекта; «complex» — акцент на ЖК,
     «street» — подсветка Ново-Садовой;
   · пока посетитель ничего не трогает, объекты переключаются сами (только когда карта видна).
   ========================================================================= */
(function () {
  "use strict";
  const $$ = (s, c) => Array.from(c.querySelectorAll(s));

  function init(map, opts) {
    if (!map || !map.dataset.vb) return null;
    const o = Object.assign({ list: null, interval: 3400, curve: 0.22 }, opts);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) map.classList.add("map--anim");

    const [VW, VH] = map.dataset.vb.split(" ").map(Number);
    const home = map.querySelector(".pin--home");
    const HX = +home.dataset.x, HY = +home.dataset.y;
    const route = map.querySelector(".map__route");
    const pins = $$(".pin[data-key]:not(.pin--home)", map);
    const marks = $$("[data-key]", map);          // всё, что подсвечивается по ключу: метки, улица и её подпись
    const items = o.list ? $$(o.list, document) : [];
    const keys = pins.map(p => p.dataset.key);
    pins.forEach((p, i) => p.style.setProperty("--n", i + 1));

    function layout() {
      const w = map.clientWidth, h = map.clientHeight;
      if (!w || !h) return;
      const s = Math.max(w / VW, h / VH);
      const ox = (w - VW * s) / 2, oy = (h - VH * s) / 2;
      $$("[data-x]", map).forEach(el => {
        el.style.left = (ox + el.dataset.x * s).toFixed(1) + "px";
        el.style.top = (oy + el.dataset.y * s).toFixed(1) + "px";
        if (el.dataset.r) el.style.setProperty("--r", el.dataset.r + "deg");
      });
      // сторона подписи: data-side, а если не помещается — противоположная
      pins.forEach(p => {
        const x = ox + p.dataset.x * s, pw = p.offsetWidth;
        const fitsR = x - 8 + pw <= w - 8, fitsL = x + 8 - pw >= 8;
        p.classList.toggle("is-left", p.dataset.side === "left" ? fitsL || !fitsR : !fitsR && fitsL);
      });
      // подпись ЖК по центру над меткой — сдвигаем внутрь кадра, если упирается в край
      const hl = home.querySelector(".pin__lbl");
      if (hl) {
        const x = ox + HX * s, half = hl.offsetWidth / 2;
        const dx = Math.min(0, w - 8 - (x + half)) + Math.max(0, 8 - (x - half));
        home.style.setProperty("--dx", Math.round(dx) + "px");
      }
      requestAnimationFrame(() => {
        const mr = map.getBoundingClientRect();
        // заняты плитки меток и видимые подписи (на телефоне подписи неактивных меток скрыты)
        const busy = $$(".pin__tile, .pin__lbl", map).filter(el => getComputedStyle(el).visibility !== "hidden").map(el => el.getBoundingClientRect());
        $$(".map__lbl", map).forEach(el => {
          el.hidden = false;
          const r = el.getBoundingClientRect();
          const out = r.left < mr.left + 8 || r.right > mr.right - 8 || r.top < mr.top + 8 || r.bottom > mr.bottom - 24;
          const hit = busy.some(b => b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom);
          el.hidden = out || hit;
        });
      });
      map.style.setProperty("--cx", ((ox + HX * s) / w * 100).toFixed(1) + "%");
      map.style.setProperty("--cy", ((oy + HY * s) / h * 100).toFixed(1) + "%");
    }
    new ResizeObserver(layout).observe(map);
    layout();
    if (document.fonts) document.fonts.ready.then(layout);

    let current = null;
    function activate(key) {
      if (key === current) return;
      current = key;
      marks.forEach(m => m.classList.toggle("is-active", m.dataset.key === key));
      items.forEach(t => t.classList.toggle("is-active", t.dataset.key === key));
      if (!route) return;
      const p = pins.find(x => x.dataset.key === key);
      route.classList.remove("is-drawn");
      if (!p) { route.setAttribute("d", "M" + HX + " " + HY); return; }
      const tx = +p.dataset.x, ty = +p.dataset.y;
      const mx = (HX + tx) / 2, my = (HY + ty) / 2, dx = tx - HX, dy = ty - HY;
      route.setAttribute("d", "M" + HX + " " + HY + "Q" + (mx - dy * o.curve).toFixed(0) + " " + (my + dx * o.curve).toFixed(0) + " " + tx + " " + ty);
      void route.getBoundingClientRect();
      route.classList.add("is-drawn");
    }

    let timer = null, touched = false, visible = false;
    const stop = () => { clearInterval(timer); timer = null; };
    const cycle = () => {
      stop();
      if (touched || !visible || reduced || !o.interval) return;
      timer = setInterval(() => activate(keys[(keys.indexOf(current) + 1) % keys.length]), o.interval);
    };
    const pick = key => { touched = true; stop(); activate(key); };
    const hover = matchMedia("(hover: hover)");
    pins.forEach(p => {
      p.addEventListener("click", () => pick(p.dataset.key));
      p.addEventListener("focus", () => pick(p.dataset.key));
      p.addEventListener("mouseenter", () => { if (hover.matches) pick(p.dataset.key); });
    });
    items.forEach(t => {
      t.addEventListener("click", () => pick(t.dataset.key));
      t.addEventListener("focus", () => pick(t.dataset.key));
      t.addEventListener("mouseenter", () => { if (hover.matches) pick(t.dataset.key); });
    });

    const start = () => {
      map.classList.add("is-in");
      setTimeout(() => { map.classList.add("is-ready"); if (!current && keys.length) activate(keys[0]); cycle(); }, reduced ? 0 : 1500);
    };
    if ("IntersectionObserver" in window) {
      let started = false;
      new IntersectionObserver(([en]) => {
        visible = en.isIntersecting;
        if (visible && !started) { started = true; start(); }
        else if (started) visible ? cycle() : stop();
      }, { threshold: 0.35 }).observe(map);
    } else { visible = true; start(); }

    return { activate, layout };
  }

  window.BrandMap = { init };
})();
