(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const total = slides.length;
  const curEl = document.getElementById('curSlide');
  const totalEl = document.getElementById('totalSlides');
  const progressBar = document.getElementById('progressBar');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const menuBtn = document.getElementById('menuBtn');
  const sidenav = document.querySelector('.sidenav');
  const sideNavList = document.getElementById('sideNavList');

  let current = 0;

  totalEl.textContent = total;

  // Build side nav
  slides.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.dataset.title || `Slide ${i + 1}`;
    li.addEventListener('click', () => {
      goTo(i);
      sidenav.classList.remove('open');
    });
    sideNavList.appendChild(li);
  });
  const navItems = Array.from(sideNavList.querySelectorAll('li'));

  function setActive(i) {
    current = i;
    curEl.textContent = i + 1;
    progressBar.style.width = `${((i + 1) / total) * 100}%`;
    navItems.forEach((el, idx) => el.classList.toggle('active', idx === i));
  }

  function goTo(i) {
    if (i < 0 || i >= total) return;
    slides[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(i);
  }

  // Detect current slide on scroll
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = slides.indexOf(entry.target);
          if (idx !== -1) setActive(idx);
        }
      });
    },
    { threshold: 0.55 }
  );
  slides.forEach((s) => observer.observe(s));

  // Buttons
  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));
  menuBtn.addEventListener('click', () => sidenav.classList.toggle('open'));

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      goTo(current + 1);
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === 'Home') {
      goTo(0);
    } else if (e.key === 'End') {
      goTo(total - 1);
    } else if (e.key === 'Escape') {
      sidenav.classList.remove('open');
    } else if (e.key.toLowerCase() === 'f') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    } else if (e.key.toLowerCase() === 'p') {
      window.print();
    }
  });

  // Init
  setActive(0);
})();
