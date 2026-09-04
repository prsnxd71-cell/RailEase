const nav = document.querySelector('.nav-wrap');
const menu = document.querySelector('.menu-toggle');

addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 18), { passive: true });
menu?.addEventListener('click', () => menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true')));

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('visible');
    entry.target.querySelectorAll('.meter i').forEach((meter) => meter.style.width = meter.style.getPropertyValue('--level'));
    entry.target.querySelectorAll('[data-count]').forEach(animateNumber);
    observer.unobserve(entry.target);
  });
}, { threshold: .16 });
document.querySelectorAll('.reveal, .metrics').forEach((element) => observer.observe(element));

function animateNumber(el) {
  if (el.dataset.done) return;
  el.dataset.done = 'true';
  const target = Number(el.dataset.count), decimal = el.dataset.decimal === 'true', suffix = el.dataset.suffix || '';
  const start = performance.now(), duration = 850;
  const tick = (time) => {
    const progress = Math.min((time - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = target * eased;
    el.textContent = (decimal ? value.toFixed(1) : Math.round(value)) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
  document.querySelector('.nav-links .active')?.classList.remove('active'); link.classList.add('active');
  menu?.setAttribute('aria-expanded', 'false');
}));
