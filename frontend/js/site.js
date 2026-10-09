const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
  siteNav?.classList.toggle('is-open', !isOpen);
});

siteNav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Abrir menu');
    siteNav.classList.remove('is-open');
  }
});

document.querySelector('#current-year').textContent = new Date().getFullYear();

const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }
}, { threshold: 0.12 });

document.querySelectorAll('.intro-grid, .section-heading, .empty-agenda, .about-image, .about-copy, .contact-grid')
  .forEach((element) => {
    element.classList.add('reveal');
    revealObserver.observe(element);
  });