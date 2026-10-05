/* =========================================================================
   ЗИМ Галерея — лендинг «Запись на экскурсию», вариация 2 («Плитка-окно»)
   Движение: GSAP 3 + ScrollTrigger + SplitText, плавный скролл Lenis.
   Сквозной приём — фирменная скошенная плитка 108 × 140 как окно:
   фото, карта и форма открываются clip-path в форме плитки.
   · заголовки «прочерчивает» оранжевая плашка (строка за строкой);
   · первый экран: плитка растёт, рендер выходит из неё, слои с разной глубиной;
   · маршрут экскурсии рисуется за скроллом и зажигает остановки;
   · панорама квартала собирается из трёх полос, триптих домов с параллаксом;
   · преимущества: фото едут вверх, тексты вниз (пин только на десктопе);
   · условия: цифры прокручиваются лентой, как счётчик;
   · отзывы: вкладки с автопрокруткой, пока блок на экране.
   Всё отключается при prefers-reduced-motion.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- Настройки проекта ---------- */
  const CONFIG = {
    FORM_ENDPOINT: "",   // URL обработчика заявок (CRM / вебхук). Пусто — заявка не уходит, показывается успех (режим фронта)
    YM_COUNTER: null,    // номер счётчика Яндекс Метрики для reachGoal
    YM_GOAL: "excursion_lead"
  };

  const root = document.documentElement;
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DESK = "(min-width: 1024px)";
  const MOB = "(max-width: 1023.98px)";
  const FINE = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const HAS_GSAP = !!(window.gsap && window.ScrollTrigger);
  const MOTION = HAS_GSAP && !REDUCED;
  const header = $("#header");

  if (!MOTION) root.classList.add("motion-off");
  if (HAS_GSAP) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.SplitText) gsap.registerPlugin(SplitText);
  }

  /* =======================================================================
     Геометрия фирменной плитки: контур 108 × 140, масштаб вокруг центра,
     подбор масштаба, при котором плитка целиком накрывает кадр
     ======================================================================= */
  const TILE = [[0, 0], [82, 0], [108, 57], [108, 140], [27, 140], [0, 83]];
  const tilePts = (s, cx, cy) => TILE.map(([x, y]) => [cx + (x - 54) * s, cy + (y - 70) * s]);
  function inside(pts, x, y) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-6) return false;
    }
    return true;
  }
  function coverScale(w, h, cx, cy) {
    const ok = s => { const p = tilePts(s, cx, cy); return inside(p, 0, 0) && inside(p, w, 0) && inside(p, w, h) && inside(p, 0, h); };
    let lo = 0, hi = Math.max(w, h) / 60;
    while (!ok(hi)) hi *= 2;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    return hi * 1.03;
  }
  const tilePath = (s, cx, cy) => "M" + tilePts(s, cx, cy).map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";

  /* Плитка-окно: кадр открывается из маленькой плитки до полного размера.
     at — центр плитки в долях кадра (или функция), from — высота стартовой плитки в долях высоты кадра.
     Поверх кадра лежит «вуаль» цвета фона с вырезом-плиткой (SVG, even-odd): в кадрах анимации меняется
     только этот вектор, фото остаётся в своём слое — не перерисовывается и не декодируется заново
     (clip-path по многоугольнику перерисовывал фото в каждом кадре). */
  const SVGNS = "http://www.w3.org/2000/svg";
  const bgOf = node => {
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  function aperture(el, opts) {
    const o = Object.assign({ from: .2, at: [.5, .5], inner: null, vars: {} }, opts);
    const st = { p: 0 };
    const veil = document.createElementNS(SVGNS, "svg");
    veil.setAttribute("class", "ap-veil");
    veil.setAttribute("aria-hidden", "true");
    veil.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("fill-rule", "evenodd");
    veil.appendChild(path);
    if (el.tagName === "IMG") el.after(veil); else el.appendChild(veil);
    let g = null, dead = false, hidden = false, shut = null;
    // вуаль шире кадра на AP_PAD с каждой стороны (см. .ap-veil): её сглаженный край уходит за обрезку кадра,
    // иначе на телефонах по контуру закрытого кадра просвечивает тонкая рамка
    const AP_PAD = 3;
    // размеры кадра, цвет фона вокруг и масштаб «плитка накрывает кадр» — на refresh, а не в каждом кадре
    const measure = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) { g = null; return; }
      const at = typeof o.at === "function" ? o.at() : o.at;
      const cx = w * at[0], cy = h * at[1], s0 = Math.max(h * o.from, 28) / 140;
      g = { w, h, cx, cy, s0, s1: coverScale(w, h, cx, cy) };
      veil.setAttribute("viewBox", -AP_PAD + " " + -AP_PAD + " " + (w + AP_PAD * 2) + " " + (h + AP_PAD * 2));
      path.setAttribute("fill", bgOf(el.parentElement));
    };
    const apply = () => {
      if (dead) return;
      // пока раскрытие не началось, фото под вуалью скрыто — просвечивать по краю нечему
      const closed = st.p <= 0;
      if (o.inner && closed !== shut) { o.inner.style.visibility = closed ? "hidden" : ""; shut = closed; }
      const done = st.p >= 1;
      if (done !== hidden) { veil.style.display = done ? "none" : ""; hidden = done; }
      if (done) return;
      if (!g) measure();
      if (g) path.setAttribute("d", "M" + -AP_PAD + " " + -AP_PAD + "H" + (g.w + AP_PAD) + "V" + (g.h + AP_PAD) + "H" + -AP_PAD + "Z" + tilePath(g.s0 + (g.s1 - g.s0) * st.p, g.cx, g.cy));
    };
    const onRefresh = () => { measure(); apply(); };
    measure(); apply();
    ScrollTrigger.addEventListener("refresh", onRefresh);
    const tl = gsap.timeline(Object.assign({ defaults: { ease: "expo.inOut", duration: 1.5 } }, o.vars));
    tl.to(st, { p: 1, onUpdate: apply }, 0);
    if (o.inner) {
      // фото на время раскрытия — отдельный слой: масштаб 1.28 → 1 делает видеокарта
      tl.fromTo(o.inner, { scale: 1.28 }, { scale: 1 }, 0);
      tl.eventCallback("onStart", () => { o.inner.style.willChange = "transform"; });
      tl.eventCallback("onComplete", () => { o.inner.style.willChange = ""; });
    }
    tl.dispose = () => { dead = true; ScrollTrigger.removeEventListener("refresh", onRefresh); veil.remove(); if (o.inner) { o.inner.style.willChange = ""; o.inner.style.visibility = ""; } };
    return tl;
  }

  /* Заголовок «прочерчивает» плашка: растёт слева, строка появляется, плашка уходит вправо */
  function wipeIn(split, tl, at) {
    split.lines.forEach((line, i) => {
      const mask = (split.masks && split.masks[i]) || line.parentElement;
      const bar = document.createElement("span");
      bar.className = "wipe";
      mask.appendChild(bar);
      const t = at + i * .13;
      gsap.set(line, { opacity: 0 });
      tl.fromTo(bar, { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: .5, ease: "expo.in" }, t)
        .set(line, { opacity: 1 }, t + .5)
        .set(bar, { transformOrigin: "100% 50%" }, t + .5)
        .to(bar, { scaleX: 0, duration: .75, ease: "expo.out" }, t + .5)
        .fromTo(line, { x: -18 }, { x: 0, duration: 1, ease: "expo.out", immediateRender: false }, t + .5);
    });
    return tl;
  }

  /* =======================================================================
     Прелоадер — ждёт шрифты и рендер первого экрана (минимум 1 с, максимум 3 с),
     плитки паттерна улетают вверх
     ======================================================================= */
  function imgReady(img) {
    if (!img) return Promise.resolve();
    if (img.complete && img.naturalWidth) return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    return new Promise(res => { img.addEventListener("load", res, { once: true }); img.addEventListener("error", res, { once: true }); });
  }
  function preload() {
    const tasks = [document.fonts ? document.fonts.ready : Promise.resolve(), imgReady($(".hero__render img"))];
    const min = new Promise(r => setTimeout(r, REDUCED ? 0 : 1000));
    const max = new Promise(r => setTimeout(r, 3000));
    return Promise.race([Promise.all(tasks.concat(min)), max]);
  }
  function hidePreloader() {
    const pre = $("#preloader");
    if (!pre) return;
    if (!MOTION) { pre.remove(); return; }
    gsap.timeline({ onComplete: () => pre.remove() })
      .to($$(".preloader__grid span", pre), { yPercent: -160, opacity: 0, duration: .75, ease: "expo.in", stagger: { each: .035, from: "end" } }, 0)
      .to(pre, { opacity: 0, duration: .55, ease: "power1.out" }, .5);
  }

  /* ---------- Плавный скролл: Lenis, только десктоп с мышью ---------- */
  let lenis = null;
  function initSmooth() {
    if (!MOTION || !window.Lenis || !FINE || !window.matchMedia(DESK).matches) return;
    lenis = new Lenis({ duration: 1.4, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /* ---------- Якоря: все CTA ведут к форме ---------- */
  function initAnchors() {
    $$("a[data-scroll]").forEach(a => {
      a.addEventListener("click", e => {
        const id = a.getAttribute("href");
        const target = id === "#top" ? 0 : $(id);
        if (target === null) return;
        e.preventDefault();
        const offset = target === 0 ? 0 : -(header ? header.offsetHeight : 0);
        if (lenis) {
          // Lenis сам учитывает scroll-padding-top у <html> (= высота шапки)
          lenis.scrollTo(target, { offset: 0, duration: 1.6 });
        } else {
          const y = target === 0 ? 0 : target.getBoundingClientRect().top + window.scrollY + offset;
          window.scrollTo({ top: y, behavior: REDUCED ? "auto" : "smooth" });
        }
        if (id === "#form") {
          setTimeout(() => { const f = $("#f-name"); if (f && !$(".form-success:not([hidden])")) f.focus({ preventScroll: true }); }, lenis ? 1700 : 900);
        }
      });
    });
  }

  /* ---------- Шапка: уезжает при скролле вниз, возвращается при скролле вверх ---------- */
  function initHeader() {
    if (!header || !HAS_GSAP) return;
    ScrollTrigger.create({
      start: 0, end: "max",
      onUpdate: self => header.classList.toggle("is-hidden", self.direction === 1 && self.scroll() > window.innerHeight * .5)
    });
  }

  /* ---------- Заголовки и абзацы ---------- */
  function initHeadings() {
    if (window.SplitText) {
      $$("[data-split]").forEach(el => {
        if (el.closest(".hero")) return; // первый экран — в интро
        SplitText.create(el, {
          type: "lines", mask: "lines", linesClass: "split-line", aria: "none", autoSplit: true,
          onSplit(self) {
            return wipeIn(self, gsap.timeline({ scrollTrigger: { trigger: el, start: "top 86%", once: true } }), 0);
          }
        });
      });
    }
    $$("[data-fade]").forEach(el => {
      if (el.closest(".hero")) return;
      gsap.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.2, ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
  }

  /* =======================================================================
     ПЕРВЫЙ ЭКРАН: плитка растёт снизу, рендер «строится» из неё,
     при уходе — слои с разной глубиной
     ======================================================================= */
  function heroIntro() {
    if (!MOTION) return;
    gsap.set(".hero__visual", { visibility: "visible" });
    const tl = gsap.timeline({ delay: .5, defaults: { ease: "expo.out" } });
    if (window.SplitText) {
      const splits = $$(".hero [data-split]").map((el, k) => {
        const sp = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line", aria: "none" });
        wipeIn(sp, tl, .3 + k * .32);
        return sp;
      });
      // после интро разбивку снимаем: заголовок снова переносится сам при смене ширины окна
      tl.eventCallback("onComplete", () => splits.forEach(s => s.revert()));
    }
    tl.fromTo(".hero__tile", { scaleY: 0 }, { scaleY: 1, duration: 1.5, ease: "expo.inOut" }, 0)
      .fromTo(".hero__render", { clipPath: "inset(100% 0% 0% 0%)", y: 50 }, { clipPath: "inset(0% 0% 0% 0%)", y: 0, duration: 1.9, ease: "expo.inOut",
        onStart: () => gsap.set(".hero__render", { willChange: "transform" }),
        onComplete: () => gsap.set(".hero__render", { clearProps: "clipPath,willChange" }) }, .3)
      .fromTo(".hero [data-fade]", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.1, stagger: .12 }, 1.1)
      .fromTo(".hero__label span", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: .9, stagger: .12, ease: "expo.inOut" }, 1.6)
      .fromTo(".medal", { scale: .2, rotate: -120, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 1.3, ease: "back.out(1.6)" }, 1.5);
  }

  function heroScroll() {
    const st = () => ({ trigger: ".hero", start: "top top", end: "bottom top", scrub: true });
    gsap.to(".hero__tile", { yPercent: 10, ease: "none", scrollTrigger: st() });
    gsap.to(".hero__render img", { yPercent: -5, scale: 1.06, ease: "none", scrollTrigger: st() });
    gsap.to(".hero__title", { y: -70, ease: "none", scrollTrigger: st() });
    gsap.to(".medal__art", { rotate: 50, ease: "none", scrollTrigger: st() });
  }

  /* =======================================================================
     КАК ПРОХОДИТ ЭКСКУРСИЯ: маршрут через остановки. Кривая строится по
     реальным позициям меток; «голова» линии держится на уровне 64 % экрана.
     ======================================================================= */
  function initRoute() {
    const route = $(".route");
    if (!route) return;
    const svg = $(".route__svg", route), base = $(".route__base", route), line = $(".route__line", route), bar = $(".route__bar", route);
    const stops = $$(".stop", route), marks = stops.map(s => $(".stop__mark", s));
    let samples = [], total = 1, markY = [], setOff = null, setBar = null;
    let routeTop = 0, routeH = 0, barTop = 0, barH = 1, desk = true;

    const build = () => {
      const r = route.getBoundingClientRect();
      if (!r.width) return;
      const pts = marks.map(m => { const b = m.getBoundingClientRect(); return [b.left + b.width / 2 - r.left, b.top + b.height / 2 - r.top]; });
      const f = n => n.toFixed(1);
      routeTop = r.top + window.scrollY; routeH = r.height;
      desk = window.matchMedia(DESK).matches;
      let d;
      if (desk) {
        // лестница: от левого края к первой метке, дальше S-кривыми вниз-вправо
        d = "M0 " + f(pts[0][1]) + " L" + f(pts[0][0]) + " " + f(pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], k = (x1 - x0) * .55;
          d += " C" + f(x0 + k) + " " + f(y0) + " " + f(x1 - k) + " " + f(y1) + " " + f(x1) + " " + f(y1);
        }
      } else {
        d = "M" + f(pts[0][0]) + " " + f(Math.max(0, pts[0][1] - 40)) + pts.map(p => " L" + f(p[0]) + " " + f(p[1])).join("");
        // телефон: маршрут прямой — рисуем его полосой с transform, без перерисовки SVG
        barTop = Math.max(0, pts[0][1] - 40); barH = Math.max(1, pts[pts.length - 1][1] - barTop);
        if (bar) Object.assign(bar.style, { left: f(pts[0][0] - 1.5) + "px", top: f(barTop) + "px", height: f(barH) + "px" });
      }
      svg.setAttribute("viewBox", "0 0 " + f(r.width) + " " + f(r.height));
      base.setAttribute("d", d);
      line.setAttribute("d", d);
      total = line.getTotalLength() || 1;
      samples = [];
      for (let k = 0; k <= 240; k++) { const L = total * k / 240; samples.push([line.getPointAtLength(L).y, L]); }
      markY = pts.map(p => p[1]);
    };
    const lengthAt = y => { let L = 0; for (const [sy, sl] of samples) { if (sy <= y + .5) L = sl; else break; } return L; };
    const update = () => {
      if (!setOff) return;
      const y = window.scrollY + window.innerHeight * .64 - routeTop;
      if (desk) setOff(1 - (y >= routeH ? total : lengthAt(y)) / total);
      else if (setBar) setBar(Math.min(1, Math.max(0, (y - barTop) / barH)));
      stops.forEach((s, i) => s.classList.toggle("is-reached", y >= markY[i] - 6));
    };

    build();
    if ("ResizeObserver" in window) new ResizeObserver(() => { build(); update(); }).observe(route);
    if (!MOTION) return;

    gsap.set(line, { strokeDashoffset: 1 });
    setOff = gsap.quickTo(line, "strokeDashoffset", { duration: .6, ease: "power3.out" });
    if (bar) { gsap.set(bar, { scaleY: 0 }); setBar = gsap.quickTo(bar, "scaleY", { duration: .6, ease: "power3.out" }); }
    ScrollTrigger.create({ trigger: route, start: "top bottom", end: "bottom top", onUpdate: update, onRefresh: () => { build(); update(); } });

    $$(".stop__media", route).forEach(m => aperture(m, {
      from: .22, inner: $(".book", m) || $("img", m),
      vars: { scrollTrigger: { trigger: m, start: "top 84%", once: true } }
    }));
  }

  /* =======================================================================
     ТРИ ДОМА: панорама собирается из трёх полос (каждая со своей скоростью),
     триптих домов на разной высоте с параллаксом; на телефоне — свайп
     ======================================================================= */
  function initHouses(mm) {
    const pano = $(".panorama");
    if (pano) {
      const offs = [30, 58, 16];
      const st = () => ({ trigger: pano, start: "top bottom", end: "center 55%", scrub: true });
      $$(".panorama__strip", pano).forEach((s, i) => {
        gsap.fromTo(s, { yPercent: offs[i] }, { yPercent: 0, ease: "none", scrollTrigger: st() });
        gsap.fromTo($("img", s), { scale: 1.14 }, { scale: 1, ease: "none", scrollTrigger: st() });
      });
    }
    const houses = $$(".house");
    mm.add(DESK, () => {
      const ys = [[60, -50], [150, -70], [100, -30]];
      houses.forEach((h, i) => {
        gsap.fromTo(h, { y: ys[i][0] }, { y: ys[i][1], ease: "none",
          scrollTrigger: { trigger: ".houses__list", start: "top bottom", end: "bottom top", scrub: true } });
        const m = $(".house__media", h);
        gsap.timeline({ scrollTrigger: { trigger: m, start: "top 88%", once: true } })
          .fromTo(m, { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.4, ease: "expo.inOut" }, 0)
          .fromTo($("img", m), { scale: 1.25 }, { scale: 1, duration: 1.8, ease: "expo.out" }, .2)
          .fromTo($(".house__body", h).children, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1, stagger: .08, ease: "expo.out" }, .6);
      });
    });
    mm.add(MOB, () => {
      gsap.from(houses, { x: 70, opacity: 0, stagger: .1, duration: 1.2, ease: "expo.out",
        scrollTrigger: { trigger: ".houses__list", start: "top 85%", once: true } });
    });
  }

  /* ---------- ЧТО ВЫ УВИДИТЕ: каждая ячейка открывается плиткой ---------- */
  function initFeatures() {
    $$(".cell").forEach((c, i) => {
      const m = $(".cell__media", c);
      const d = (i % 2) * .14;
      aperture(m, { from: .2, at: [.5, .55], inner: $("img", m), vars: { delay: d, scrollTrigger: { trigger: c, start: "top 86%", once: true } } });
      gsap.fromTo($(".cell__title", c), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1, delay: d + .7, ease: "expo.out",
        scrollTrigger: { trigger: c, start: "top 86%", once: true } });
    });
  }

  /* =======================================================================
     ПОЧЕМУ ВЫБИРАЮТ: встречный скролл. Экран закреплён, колонка фото едет
     вверх, колонка текстов — вниз; между карточками короткие паузы.
     ======================================================================= */
  function initAdvantages(mm) {
    const split = $(".split");
    if (!split) return;
    const imgCol = $(".split__col--img", split), txtCol = $(".split__col--txt", split), seam = $(".split__seam", split);
    const n = $$(".adv", txtCol).length;

    // фото колонки подгружаем заранее, иначе нижние кадры догружаются уже в кадре
    const pre = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      pre.disconnect();
      $$("img", imgCol).forEach(im => { im.loading = "eager"; });
    }, { rootMargin: "100% 0px" });
    pre.observe(split);

    mm.add(DESK, () => {
      split.classList.add("split--on");
      const step = 100 / n;
      gsap.set(txtCol, { yPercent: -step * (n - 1) });
      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut", duration: 1 },
        scrollTrigger: { trigger: ".split__pin", start: "top top", end: () => "+=" + window.innerHeight * (n - 1) * 1.15, pin: true, scrub: true, invalidateOnRefresh: true }
      });
      tl.to({}, { duration: .3 });
      for (let k = 1; k < n; k++) {
        tl.to(imgCol, { yPercent: -step * k }, ">")
          .to(txtCol, { yPercent: -step * (n - 1 - k) }, "<")
          .to({}, { duration: .45 });
      }
      tl.fromTo(seam, { scaleY: 0 }, { scaleY: 1, ease: "none", duration: tl.duration() }, 0);
      return () => { split.classList.remove("split--on"); gsap.set([imgCol, txtCol, seam], { clearProps: "all" }); };
    });

    mm.add(MOB, () => {
      // фото карточки открывается плиткой один раз (раньше шторка шла за скроллом и перерисовывала фото в каждом кадре)
      const tls = $$(".adv", txtCol).map(a => {
        const m = $(".adv__media", a);
        gsap.from($(".adv__body", a).children, { y: 24, opacity: 0, stagger: .07, duration: 1, ease: "expo.out",
          scrollTrigger: { trigger: a, start: "top 72%", once: true } });
        return aperture(m, { from: .22, inner: $("img", m), vars: { scrollTrigger: { trigger: m, start: "top 85%", once: true } } });
      });
      return () => tls.forEach(t => t.dispose());
    });
  }

  /* =======================================================================
     КАРТА: подложка из OpenStreetMap в цветах бренда (скилл brand-map),
     метки и легенда связаны по data-key. Раскрытие — плиткой от ЖК.
     ======================================================================= */
  function initMap() {
    const mapEl = $("#map");
    if (!mapEl || !window.BrandMap) return;
    BrandMap.init(mapEl, { list: ".location__legend [data-key]" });
    if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => mapEl.classList.toggle("is-offscreen", !e.isIntersecting)).observe(mapEl);
  }
  function mapMotion() {
    const mapEl = $("#map");
    if (!mapEl) return;
    const at = () => {
      const cs = getComputedStyle(mapEl);
      return [parseFloat(cs.getPropertyValue("--cx")) / 100 || .5, parseFloat(cs.getPropertyValue("--cy")) / 100 || .5];
    };
    aperture($(".map__base", mapEl), { from: .05, at, vars: { defaults: { ease: "expo.inOut", duration: 2 }, scrollTrigger: { trigger: mapEl, start: "top 70%", once: true } } });
    gsap.from(".location__legend li", { x: -40, opacity: 0, stagger: .07, duration: 1.1, ease: "expo.out",
      scrollTrigger: { trigger: ".location__legend", start: "top 88%", once: true } });
  }

  /* =======================================================================
     УСЛОВИЯ: цифры прокручиваются лентой. Настоящая цифра остаётся в потоке
     (ширина, базовая линия, чтение скринридером), лента лежит поверх.
     ======================================================================= */
  function buildOdometers() {
    $$("[data-odo]").forEach(el => {
      const text = el.textContent;
      el.textContent = "";
      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = text;
      const vis = document.createElement("span");
      vis.setAttribute("aria-hidden", "true");
      el.append(sr, vis);
      let c = 0;
      for (const ch of text) {
        if (!/\d/.test(ch)) { vis.appendChild(document.createTextNode(ch)); continue; }
        const d = +ch, len = 9 + c * 4, start = ((d - len + 1) % 10 + 10) % 10;
        const odo = document.createElement("span");
        odo.className = "odo is-rolling";
        odo.innerHTML = '<span class="odo__ghost">' + ch + '</span><span class="odo__strip">' +
          Array.from({ length: len }, (_, k) => "<span>" + (start + k) % 10 + "</span>").join("") + "</span>";
        vis.appendChild(odo);
        c++;
      }
    });
  }
  function initTerms() {
    buildOdometers();
    const row = $(".terms__row");
    $$(".term").forEach((t, i) => {
      const strips = $$(".odo__strip", t);
      if (!strips.length) return;
      gsap.to(strips, {
        yPercent: (k, el) => -100 * (el.children.length - 1) / el.children.length,
        duration: 2.2, ease: "expo.out", stagger: .12, delay: i * .12,
        scrollTrigger: { trigger: row, start: "top 82%", once: true },
        onComplete: () => $$(".odo", t).forEach(o => { o.classList.remove("is-rolling"); const s = $(".odo__strip", o); if (s) s.remove(); })
      });
    });
    gsap.from(".term__label", { opacity: 0, y: 16, stagger: .1, duration: 1, delay: .5, ease: "expo.out",
      scrollTrigger: { trigger: row, start: "top 82%", once: true } });
    $$(".terms__tiles i").forEach((t, i) => gsap.fromTo(t, { y: 160 + i * 70 }, { y: -24 * i, ease: "none",
      scrollTrigger: { trigger: ".terms", start: "top bottom", end: "bottom 55%", scrub: true } }));
  }

  /* =======================================================================
     ОТЗЫВЫ: вкладки по авторам (ARIA tabs), автопрокрутка с полосой
     прогресса, пока блок на экране; наведение и фокус ставят на паузу,
     любой выбор посетителя выключает автопрокрутку
     ======================================================================= */
  function initReviews() {
    const sec = $(".reviews");
    if (!sec) return;
    const tabs = $$(".rtab", sec), panels = $$(".review", sec), stage = $(".reviews__stage", sec), quote = $(".reviews__quote", sec);
    const list = $('[role="tablist"]', sec);
    if (!tabs.length || tabs.length !== panels.length) return;
    sec.classList.add("reviews--tabs");
    let cur = 0, auto = MOTION, bar = null, visible = false, hold = false;
    const fills = tabs.map(t => { const b = $(".rtab__bar", t); let f = $("i", b); if (!f) { f = document.createElement("i"); b.appendChild(f); } return f; });
    const setP = (i, v) => { fills[i].style.transform = "scaleX(" + v + ")"; };
    const sync = () => { if (bar) (visible && !hold) ? bar.resume() : bar.pause(); };

    function reveal(i) {
      // на телефоне ряд вкладок прокручивается — активную держим в поле зрения, страницу не двигаем
      if (list.scrollWidth <= list.clientWidth + 2) return;
      const t = tabs[i];
      list.scrollTo({ left: t.offsetLeft - parseFloat(getComputedStyle(list).paddingLeft || 0), behavior: REDUCED ? "auto" : "smooth" });
    }
    function run() {
      if (bar) bar.kill();
      tabs.forEach((t, k) => setP(k, 0));
      const o = { p: 0 };
      bar = gsap.to(o, { p: 1, duration: 12, ease: "none", onUpdate: () => setP(cur, o.p), onComplete: () => select((cur + 1) % tabs.length, false) });
      sync();
    }
    function stopAuto() {
      auto = false;
      if (bar) bar.kill();
      bar = null;
      tabs.forEach((t, k) => setP(k, k === cur ? 1 : 0));
    }
    function select(i, byUser) {
      if (byUser && auto) stopAuto();
      if (i === cur) return;
      const prev = panels[cur], next = panels[i];
      tabs.forEach((t, k) => { const on = k === i; t.setAttribute("aria-selected", on ? "true" : "false"); t.tabIndex = on ? 0 : -1; });
      if (MOTION) {
        gsap.killTweensOf([prev, next]);
        gsap.to(prev, { opacity: 0, y: -14, duration: .3, ease: "power2.in", onComplete: () => { prev.classList.remove("is-active"); gsap.set(prev, { clearProps: "opacity,transform" }); } });
        next.classList.add("is-active");
        gsap.fromTo(next, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: .9, delay: .22, ease: "expo.out" });
        if (quote) gsap.fromTo(quote, { scale: .5, rotate: -20, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 1.1, delay: .1, ease: "back.out(1.7)" });
      } else {
        prev.classList.remove("is-active");
        next.classList.add("is-active");
      }
      if (!auto) { setP(cur, 0); setP(i, 1); }
      cur = i;
      reveal(i);
      if (auto) run();
    }

    panels.forEach((p, i) => p.classList.toggle("is-active", i === 0));
    tabs.forEach((t, i) => t.addEventListener("click", () => select(i, true)));
    list.addEventListener("keydown", e => {
      const k = tabs.indexOf(document.activeElement);
      if (k < 0) return;
      let n = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (k + 1) % tabs.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (k - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      tabs[n].focus();
      select(n, true);
    });

    if (!auto) { setP(0, 1); return; }
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: .4 }).observe(stage);
    const setHold = v => { hold = v; sync(); };
    stage.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") setHold(true); });
    stage.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") setHold(false); });
    sec.addEventListener("focusin", () => setHold(true));
    sec.addEventListener("focusout", e => { if (!sec.contains(e.relatedTarget)) setHold(false); });
    run();
  }

  /* =======================================================================
     ФОРМА ЗАПИСИ: маска телефона, валидация, UTM, отправка
     ======================================================================= */
  function initForm() {
    const form = $("#booking-form");
    if (!form) return;
    const phone = $("#f-phone"), name = $("#f-name"), consent = $("#f-consent");
    const status = $(".form__status", form);
    const success = $(".form-success");
    let tried = false;

    // UTM-метки из адреса → скрытые поля (для аналитики РК)
    const params = new URLSearchParams(location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(k => {
      const input = form.elements[k];
      if (input && params.get(k)) input.value = params.get(k);
    });

    const digits = v => v.replace(/\D/g, "");
    const formatPhone = v => {
      let n = digits(v);
      // «+7» уже в поле — первая 7 это код страны; при вставке 8XXXXXXXXXX / 7XXXXXXXXXX — тоже
      if (v.trim().startsWith("+7")) n = n.slice(1);
      else if (n.length >= 11 && /^[78]/.test(n)) n = n.slice(1);
      n = n.slice(0, 10);
      let out = "+7";
      if (n.length) out += " (" + n.slice(0, 3);
      if (n.length >= 3) out += ")";
      if (n.length > 3) out += " " + n.slice(3, 6);
      if (n.length > 6) out += "-" + n.slice(6, 8);
      if (n.length > 8) out += "-" + n.slice(8, 10);
      return out;
    };
    phone.addEventListener("focus", () => { if (!phone.value) phone.value = "+7 "; });
    phone.addEventListener("blur", () => { if (digits(phone.value).length <= 1) phone.value = ""; });
    phone.addEventListener("input", () => {
      const end = phone.selectionStart === phone.value.length;
      phone.value = formatPhone(phone.value);
      if (end) phone.setSelectionRange(phone.value.length, phone.value.length);
      if (tried) validate();
    });
    [name, consent].forEach(el => el.addEventListener("input", () => { if (tried) validate(); }));
    consent.addEventListener("change", () => { if (tried) validate(); });

    const setErr = (input, errId, bad) => {
      const err = $("#" + errId);
      input.setAttribute("aria-invalid", bad ? "true" : "false");
      if (bad) input.setAttribute("aria-describedby", errId); else input.removeAttribute("aria-describedby");
      if (err) err.hidden = !bad;
    };
    function validate() {
      const okName = name.value.trim().length >= 2;
      const okPhone = digits(phone.value).replace(/^7/, "").length === 10;
      const okConsent = consent.checked;
      setErr(name, "f-name-err", !okName);
      setErr(phone, "f-phone-err", !okPhone);
      setErr(consent, "f-consent-err", !okConsent);
      return okName ? okPhone ? okConsent ? null : consent : phone : name;
    }

    form.addEventListener("submit", async e => {
      e.preventDefault();
      tried = true;
      const bad = validate();
      if (bad) { bad.focus(); return; }
      const btn = $(".form__submit", form);
      btn.setAttribute("aria-busy", "true");
      status.textContent = "Отправляем…";
      const data = Object.fromEntries(new FormData(form).entries());
      data.consent = true;
      data.page = location.href;
      data.submitted_at = new Date().toISOString();
      try {
        if (CONFIG.FORM_ENDPOINT) {
          const res = await fetch(CONFIG.FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
          if (!res.ok) throw new Error("HTTP " + res.status);
        } else {
          await new Promise(r => setTimeout(r, 700));
          console.info("[ЗИМ] Заявка (FORM_ENDPOINT не задан, отправка не выполнялась):", data);
        }
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: "excursion_lead", format: data.format });
        if (window.ym && CONFIG.YM_COUNTER) window.ym(CONFIG.YM_COUNTER, "reachGoal", CONFIG.YM_GOAL);
        document.dispatchEvent(new CustomEvent("zim:lead", { detail: data }));
        showSuccess();
      } catch (err) {
        status.textContent = "Не получилось отправить. Позвоните нам: +7 (846) 379-68-89";
      } finally {
        btn.removeAttribute("aria-busy");
      }
    });

    function showSuccess() {
      status.textContent = "";
      const reveal = () => {
        form.hidden = true;
        success.hidden = false;
        success.focus({ preventScroll: true });
        if (MOTION) gsap.from(success.children, { y: 24, opacity: 0, stagger: .08, duration: 1, ease: "expo.out" });
        if (HAS_GSAP) ScrollTrigger.refresh();
        // форма схлопнулась — возвращаем блок «Заявка принята» в поле зрения
        const r = success.getBoundingClientRect();
        if (r.top < (header ? header.offsetHeight : 0) || r.bottom > window.innerHeight) {
          if (lenis) lenis.scrollTo(success, { offset: -40, duration: 1 });
          else success.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
        }
      };
      if (MOTION) gsap.to(form, { opacity: 0, y: -16, duration: .5, ease: "power2.in", onComplete: reveal });
      else reveal();
    }
  }

  /* ---------- ФОРМА: фото открывается плиткой по скроллу, панель подъезжает ---------- */
  function initBooking(mm) {
    const photo = $(".booking__photo");
    const img = photo && $("img", photo);
    mm.add(DESK, () => {
      const tl = photo && aperture(photo, { from: .14, at: [.3, .55], inner: img,
        vars: { defaults: { ease: "none", duration: 1 }, scrollTrigger: { trigger: ".booking", start: "top 92%", end: "top 12%", scrub: true } } });
      gsap.fromTo(".booking__panel", { y: 120 }, { y: 0, ease: "none",
        scrollTrigger: { trigger: ".booking", start: "top bottom", end: "top 15%", scrub: true } });
      return () => { if (tl) tl.dispose(); };
    });
    mm.add(MOB, () => {
      const tl = photo && aperture(photo, { from: .14, at: [.3, .55], inner: img,
        vars: { scrollTrigger: { trigger: photo, start: "top 82%", once: true } } });
      return () => { if (tl) tl.dispose(); };
    });
    gsap.from(".form > *", { y: 20, opacity: 0, stagger: .06, duration: 1, ease: "expo.out",
      scrollTrigger: { trigger: ".form", start: "top 88%", once: true } });
  }

  /* ---------- ФУТЕР: слоган поднимается по словам, содержимое «догоняет» страницу (только десктоп) ---------- */
  function initFooter(mm) {
    const slogan = $(".footer__slogan");
    if (slogan && window.SplitText) {
      const sp = SplitText.create(slogan, { type: "words", mask: "words", wordsClass: "split-word", aria: "none" });
      gsap.fromTo(sp.words, { yPercent: 110 }, { yPercent: 0, ease: "none", stagger: .15,
        scrollTrigger: { trigger: ".footer", start: "top bottom", end: "top 30%", scrub: true } });
    }
    // сдвиг в пикселях и меньше верхнего отступа подвала: в процентах от высоты (на телефоне подвал высокий
    // из-за юридического текста) слоган уезжал под блок формы и обрезался
    mm.add(DESK, () => {
      gsap.fromTo(".footer__inner", { y: -72 }, { y: 0, ease: "none",
        scrollTrigger: { trigger: ".footer", start: "top bottom", end: "bottom bottom", scrub: true } });
    });
  }

  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* =======================================================================
     СТАРТ
     ======================================================================= */
  // отдать поток браузеру между этапами: вместо одной длинной задачи — несколько коротких
  const yieldTask = () => new Promise(r => (window.scheduler && scheduler.yield) ? scheduler.yield().then(r) : setTimeout(r, 0));

  async function start() {
    initAnchors();
    initReviews();
    initForm();
    initMap();
    initHeader();
    initRoute();
    if (!MOTION) return;

    initSmooth();
    const mm = gsap.matchMedia();
    heroScroll();
    // порядок важен: триггеры создаются сверху вниз, иначе ScrollTrigger неверно учитывает пин преимуществ
    for (const init of [initHeadings, () => initHouses(mm), initFeatures, () => initAdvantages(mm), mapMotion, initTerms, () => initBooking(mm), () => initFooter(mm)]) {
      await yieldTask();
      init();
    }

    let lastW = window.innerWidth;
    window.addEventListener("resize", debounce(() => {
      if (window.innerWidth === lastW) return; // игнорируем прыжки адресной строки
      lastW = window.innerWidth;
      ScrollTrigger.refresh();
    }, 300));
    window.addEventListener("load", () => ScrollTrigger.refresh());
  }

  preload().then(async () => {
    root.classList.add("is-ready");
    await start();
    // тяжёлая инициализация — пока прелоадер закрывает экран; уход прелоадера и интро — со следующего кадра
    if (MOTION) { ScrollTrigger.sort(); ScrollTrigger.refresh(); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      hidePreloader();
      heroIntro();
    }));
  });
})();
