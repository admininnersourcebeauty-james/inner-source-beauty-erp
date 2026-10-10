(function () {
  'use strict';

  /* Mobile navigation */
  var menuToggle = document.querySelector('[data-isb-menu-toggle]');
  var mobileNav = document.querySelector('[data-isb-mobile-nav]');
  var menuClose = document.querySelector('[data-isb-menu-close]');

  function openMenu() {
    if (!mobileNav || !menuToggle) return;
    mobileNav.hidden = false;
    menuToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    if (!mobileNav || !menuToggle) return;
    mobileNav.hidden = true;
    menuToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', openMenu);
    if (menuClose) menuClose.addEventListener('click', closeMenu);
    mobileNav.addEventListener('click', function (e) {
      if (e.target === mobileNav) closeMenu();
    });
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
  }

  /* Testimonials carousel (mobile / tablet) */
  document.querySelectorAll('[data-isb-testimonials]').forEach(function (section) {
    var slides = Array.from(section.querySelectorAll('[data-isb-testimonial-slide]'));
    var prev = section.querySelector('[data-isb-testimonial-prev]');
    var next = section.querySelector('[data-isb-testimonial-next]');
    var carousel = section.querySelector('.isb-testimonials__carousel');
    var index = 0;

    if (slides.length <= 1) return;

    function showSlide(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach(function (slide, idx) {
        slide.classList.toggle('is-active', idx === index);
      });
    }

    function enableCarousel() {
      if (window.innerWidth < 990) {
        carousel.classList.add('is-carousel-active');
        showSlide(index);
      } else {
        carousel.classList.remove('is-carousel-active');
        slides.forEach(function (slide) {
          slide.classList.remove('is-active');
        });
      }
    }

    if (prev) {
      prev.addEventListener('click', function () {
        showSlide(index - 1);
      });
    }

    if (next) {
      next.addEventListener('click', function () {
        showSlide(index + 1);
      });
    }

    enableCarousel();
    window.addEventListener('resize', enableCarousel);
  });
})();
