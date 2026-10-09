const api = '/api/v1';
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function activityDate(activity) {
  return activity.starts_at ? dateFormatter.format(new Date(activity.starts_at)) : 'Data a confirmar';
}

function activityPrice(activity) {
  const cents = activity.promotional_price_cents ?? activity.price_cents;
  return cents == null ? 'Consulte o investimento' : priceFormatter.format(cents / 100);
}

function activityCard(activity, kind) {
  const article = document.createElement('article');
  article.className = 'activity-card';

  if (activity.image_url) {
    const image = document.createElement('img');
    image.className = 'activity-image';
    image.src = activity.image_url;
    image.alt = '';
    image.loading = 'lazy';
    article.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'activity-image activity-image-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    article.append(placeholder);
  }

  const body = document.createElement('div');
  body.className = 'activity-card-body';
  addText(body, 'p', 'activity-kind', kind === 'courses' ? 'Curso' : 'Evento');
  if (activity.category_name) addText(body, 'p', 'activity-category', activity.category_name);
  const title = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = `/atividade.html?tipo=${kind === 'courses' ? 'curso' : 'evento'}&slug=${encodeURIComponent(activity.slug)}`;
  titleLink.textContent = activity.title;
  title.append(titleLink);
  body.append(title);
  addText(body, 'p', 'activity-description', activity.short_description);
  if (activity.instructors?.length) {
    addText(body, 'p', 'activity-instructors', activity.instructors.map((instructor) => instructor.name).join(' · '));
  }

  const details = document.createElement('dl');
  details.className = 'activity-details';
  for (const [label, value] of [
    ['Data', activityDate(activity)],
    ['Formato', { in_person: 'Presencial', online: 'Online', hybrid: 'Híbrido' }[activity.modality] || 'A confirmar'],
    ['Local', activity.location || 'A confirmar'],
    ['Investimento', activityPrice(activity)],
  ]) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    row.append(term, description);
    details.append(row);
  }
  body.append(details);

  const detailLink = document.createElement('a');
  detailLink.className = 'button button-outline activity-detail-link';
  detailLink.href = `/atividade.html?tipo=${kind === 'courses' ? 'curso' : 'evento'}&slug=${encodeURIComponent(activity.slug)}`;
  detailLink.textContent = `Ver detalhes do ${kind === 'courses' ? 'curso' : 'evento'} ↗`;
  body.append(detailLink);

  if (activity.status === 'enrollments_open') {
    const link = document.createElement('a');
    link.className = 'button button-primary activity-action';
    link.href = `/inscricao.html?tipo=${kind === 'courses' ? 'curso' : 'evento'}&id=${encodeURIComponent(activity.id)}`;
    link.append(document.createTextNode('Quero me inscrever '));
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    link.append(arrow);
    body.append(link);
  } else {
    addText(body, 'p', 'activity-status', 'Inscrições em breve');
  }

  article.append(body);
  return article;
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'catalog-empty';
  addText(empty, 'span', 'empty-mark', '✳');
  addText(empty, 'h3', '', message);
  addText(empty, 'p', '', 'Quando novas datas forem publicadas, elas aparecerão aqui.');
  container.append(empty);
}

async function fetchActivities(kind) {
  const response = await fetch(`${api}/${kind}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Não foi possível carregar a agenda agora.');
  const body = await response.json();
  return body[kind];
}

async function loadPublicSettings() {
  try {
    const response = await fetch(`${api}/settings`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { settings } = await response.json();
    const displayValues = {
      site_name: settings.site_name,
      tagline: settings.tagline,
      banner_title: settings.banner_title,
      banner_subtitle: settings.banner_subtitle,
    };
    for (const element of document.querySelectorAll('[data-site-setting]')) {
      const value = displayValues[element.dataset.siteSetting.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
      if (typeof value === 'string' && value.trim()) element.textContent = value;
    }
    for (const image of document.querySelectorAll('[data-site-setting-image]')) {
      const key = image.dataset.siteSettingImage.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      if (typeof settings[key] === 'string' && settings[key].trim()) image.src = settings[key];
    }
    applyHomepageSections(settings.homepage_sections);
    applyMenuItems(settings.menu_items);

    if (!document.querySelector('[data-blog-detail], [data-activity-detail]')) {
      setPageMetadata({
        title: settings.seo_title || `${settings.site_name || 'Constelação Familiar'} | Encontros e cursos`,
        description: settings.seo_description || settings.tagline || 'Cursos, encontros e conteúdos de Constelação Familiar.',
        image: settings.og_image_url,
      });
    }
    if (settings.seo_keywords) {
      let keywords = document.querySelector('meta[name="keywords"]');
      if (!keywords) {
        keywords = document.createElement('meta');
        keywords.name = 'keywords';
        document.head.append(keywords);
      }
      keywords.content = settings.seo_keywords;
    }
    if (settings.google_search_console_verification) {
      let verification = document.querySelector('meta[name="google-site-verification"]');
      if (!verification) {
        verification = document.createElement('meta');
        verification.name = 'google-site-verification';
        document.head.append(verification);
      }
      verification.content = settings.google_search_console_verification;
    }
    if (settings.primary_color) document.documentElement.style.setProperty('--forest', settings.primary_color);
    if (settings.secondary_color) {
      document.documentElement.style.setProperty('--coral', settings.secondary_color);
      document.documentElement.style.setProperty('--coral-dark', settings.secondary_color);
    }

    const contact = document.querySelector('[data-site-contact]');
    const details = [];
    if (settings.contact_email) {
      const link = document.createElement('a');
      link.href = `mailto:${settings.contact_email}`;
      link.textContent = settings.contact_email;
      const line = document.createElement('div');
      line.append(link);
      details.push(line);
    }
    if (settings.phone) {
      const link = document.createElement('a');
      link.href = `tel:${settings.phone.replace(/[^\d+]/g, '')}`;
      link.textContent = settings.phone;
      const line = document.createElement('div');
      line.append(link);
      details.push(line);
    }
    if (settings.address) details.push(addText(document.createElement('div'), 'span', '', settings.address));
    if (settings.whatsapp_number) {
      const digits = settings.whatsapp_number.replace(/\D/g, '');
      if (digits) {
        const link = document.createElement('a');
        link.href = `https://wa.me/${digits}?text=${encodeURIComponent(settings.whatsapp_message || '')}`;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Conversar pelo WhatsApp';
        const line = document.createElement('div');
        line.append(link);
        details.push(line);
      }
    }
    if (details.length && contact) {
      contact.replaceChildren(addText(contact, 'p', '', 'Entre em contato pelos canais abaixo.'), ...details.map((line) => line));
    }

    const socials = document.querySelector('[data-social-links]');
    const socialLabels = [
      ['instagram_url', 'Instagram'], ['facebook_url', 'Facebook'], ['tiktok_url', 'TikTok'],
      ['youtube_url', 'YouTube'], ['linkedin_url', 'LinkedIn'],
    ];
    for (const [key, label] of socialLabels) {
      if (!settings[key]) continue;
      const link = document.createElement('a');
      link.href = settings[key];
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = label;
      socials?.append(link);
    }
  } catch {
    return;
  }
}

function applyHomepageSections(items) {
  if (!Array.isArray(items) || !document.querySelector('[data-home-section]')) return;
  const sections = new Map([...document.querySelectorAll('[data-home-section]')].map((section) => [section.dataset.homeSection, section]));
  for (const item of items) {
    const section = sections.get(item.key);
    if (!section) continue;
    section.dataset.configurationActive = String(Boolean(item.active));
    if (item.key !== 'instructors') section.hidden = !item.active;
  }
  const ordered = items
    .map((item) => ({ section: sections.get(item.key), order: item.order }))
    .filter((item) => item.section)
    .sort((left, right) => left.order - right.order);
  const main = document.querySelector('main');
  if (main && ordered.length) main.append(...ordered.map((item) => item.section));
}

function applyMenuItems(items) {
  const nav = document.querySelector('.site-nav');
  if (!nav || !Array.isArray(items)) return;
  const menuDestinations = {
    home: { label: 'Início', href: '/#inicio' },
    approach: { label: 'A abordagem', href: '/#olhar' },
    courses: { label: 'Cursos', href: '/cursos.html' },
    events: { label: 'Eventos', href: '/eventos.html' },
    about: { label: 'Sobre', href: '/#sobre' },
    blog: { label: 'Blog', href: '/blog.html' },
    contact: { label: 'Contato', href: '/contato.html', cta: true },
  };
  const pathname = location.pathname;
  const links = items
    .filter((item) => item.active && menuDestinations[item.key])
    .sort((left, right) => left.order - right.order)
    .map((item) => {
      const destination = menuDestinations[item.key];
      const link = document.createElement('a');
      link.href = destination.href;
      link.textContent = item.label || destination.label;
      if (destination.cta) link.className = 'nav-cta';
      if ((item.key === 'courses' && pathname === '/cursos.html')
        || (item.key === 'events' && pathname === '/eventos.html')
        || (item.key === 'blog' && ['/blog.html', '/artigo.html'].includes(pathname))) {
        link.setAttribute('aria-current', 'page');
      }
      if (destination.cta) {
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '↗';
        link.append(arrow);
      }
      return link;
    });
  nav.replaceChildren(...links);
}

async function loadPublicInstructors() {
  const section = document.querySelector('[data-public-instructors]');
  const list = document.querySelector('[data-instructor-list]');
  try {
    const response = await fetch(`${api}/instructors`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { instructors } = await response.json();
    if (instructors.length === 0) return;

    for (const instructor of instructors) {
      const card = document.createElement('article');
      card.className = 'instructor-card';
      if (instructor.photo_url) {
        const image = document.createElement('img');
        image.className = 'instructor-photo';
        image.src = instructor.photo_url;
        image.alt = '';
        image.loading = 'lazy';
        card.append(image);
      } else {
        addText(card, 'span', 'instructor-photo instructor-photo-placeholder', instructor.name.slice(0, 1).toUpperCase());
      }
      const content = document.createElement('div');
      addText(content, 'h3', '', instructor.name);
      if (instructor.qualifications) addText(content, 'p', '', instructor.qualifications);
      else if (instructor.specialties) addText(content, 'p', '', instructor.specialties);
      else if (instructor.biography) addText(content, 'p', '', instructor.biography);
      const profileUrl = instructor.website_url || instructor.instagram_url;
      if (profileUrl) {
        const link = document.createElement('a');
        link.href = profileUrl;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Conhecer perfil ↗';
        content.append(link);
      }
      card.append(content);
      list.append(card);
    }
    if (section.dataset.configurationActive !== 'false') section.hidden = false;
  } catch {
    return;
  }
}

async function renderActivityList(container, kind) {
  try {
    const activities = await fetchActivities(kind);
    container.replaceChildren();
    if (activities.length === 0) {
      renderEmpty(container, kind === 'courses' ? 'Novas turmas em breve' : 'Novos encontros em breve');
      return activities;
    }
    for (const activity of activities) container.append(activityCard(activity, kind));
    return activities;
  } catch {
    renderEmpty(container, 'Não foi possível carregar as informações');
    addText(container, 'p', 'form-feedback is-error', 'Tente atualizar a página em instantes.');
    return [];
  }
}

async function loadFeaturedActivities(container) {
  try {
    const [courses, events] = await Promise.all([fetchActivities('courses'), fetchActivities('events')]);
    const activities = [
      ...courses.map((activity) => ({ ...activity, kind: 'courses' })),
      ...events.map((activity) => ({ ...activity, kind: 'events' })),
    ].sort((left, right) => new Date(left.starts_at || '9999-12-31') - new Date(right.starts_at || '9999-12-31'));

    container.replaceChildren();
    if (activities.length === 0) {
      renderEmpty(container, 'Novas datas em breve');
      const link = document.createElement('a');
      link.className = 'text-link featured-empty-link';
      link.href = '/eventos.html';
      link.textContent = 'Ver agenda de eventos ↗';
      container.append(link);
      return;
    }
    container.classList.add('activity-grid');
    for (const activity of activities.slice(0, 3)) {
      container.append(activityCard(activity, activity.kind));
    }
  } catch {
    renderEmpty(container, 'Não foi possível carregar a agenda');
  }
}

function showFeedback(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
  element.classList.toggle('is-success', !isError);
}

function setupContactForm(form) {
  const feedback = form.querySelector('.form-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    fields.privacyConsent = form.elements.privacyConsent.checked;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showFeedback(feedback, 'Enviando mensagem...');
    try {
      const response = await fetch(`${api}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível enviar sua mensagem.');
      form.reset();
      showFeedback(feedback, 'Mensagem recebida. Obrigado por entrar em contato.');
    } catch (error) {
      showFeedback(feedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function setupEnrollmentForm(form) {
  const feedback = form.querySelector('.form-status');
  const summary = document.querySelector('[data-selected-activity]');
  const parameters = new URLSearchParams(location.search);
  const kind = parameters.get('tipo') === 'evento' ? 'events' : 'courses';
  const id = parameters.get('id');
  const idField = kind === 'events' ? 'eventId' : 'courseId';
  let activity;

  try {
    if (!id) throw new Error('Selecione um curso ou evento na agenda.');
    activity = (await fetchActivities(kind)).find((item) => item.id === id);
    if (!activity) throw new Error('Esta atividade não está disponível para inscrição.');
    summary.replaceChildren();
    addText(summary, 'h2', '', activity.title);
    addText(summary, 'p', '', `${activityDate(activity)} · ${activity.location || 'Local a confirmar'} · ${activityPrice(activity)}`);
    if (activity.status !== 'enrollments_open') {
      throw new Error('As inscrições para esta atividade ainda não estão abertas.');
    }
  } catch (error) {
    summary.replaceChildren();
    addText(summary, 'p', 'form-feedback is-error', error.message);
    form.hidden = true;
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    fields[idField] = activity.id;
    fields.privacyConsent = form.elements.privacyConsent.checked;
    if (fields.state) fields.state = fields.state.toUpperCase();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showFeedback(feedback, 'Enviando inscrição...');
    try {
      const response = await fetch(`${api}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a inscrição.');
      form.reset();
      showFeedback(feedback, 'Recebemos sua inscrição. Em breve entraremos em contato.');
    } catch (error) {
      showFeedback(feedback, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function loadBlogPreview() {
  const container = document.querySelector('[data-blog-preview]');
  if (!container) return;
  try {
    const response = await fetch(`${api}/blog`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { posts } = await response.json();
    container.replaceChildren();
    if (!posts.length) return;
    for (const post of posts.slice(0, 2)) {
      const card = document.createElement('article');
      card.className = 'content-card';
      if (post.image_url) {
        const image = document.createElement('img');
        image.src = post.image_url;
        image.alt = '';
        image.loading = 'lazy';
        image.className = 'content-card-image';
        card.append(image);
      }
      const body = document.createElement('div');
      body.className = 'content-card-body';
      addText(body, 'p', 'content-card-meta', post.published_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(post.published_at)) : 'Publicação');
      addText(body, 'h3', '', post.title);
      addText(body, 'p', 'content-card-copy', post.excerpt);
      const link = document.createElement('a');
      link.className = 'text-link';
      link.href = `/artigo.html?slug=${encodeURIComponent(post.slug)}`;
      link.textContent = 'Leia o artigo';
      body.append(link);
      card.append(body);
      container.append(card);
    }
  } catch {
    return;
  }
}

async function loadTestimonials() {
  const container = document.querySelector('[data-testimonials-list]');
  if (!container) return;
  try {
    const response = await fetch(`${api}/testimonials`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { testimonials } = await response.json();
    container.replaceChildren();
    if (!testimonials.length) return;
    for (const testimonial of testimonials) {
      const card = document.createElement('article');
      card.className = 'testimonial-card';
      const avatar = document.createElement('div');
      avatar.className = 'testimonial-avatar';
      avatar.textContent = testimonial.name?.slice(0, 1)?.toUpperCase() || '•';
      const quote = document.createElement('blockquote');
      quote.textContent = `“${testimonial.quote}”`;
      const author = document.createElement('p');
      author.className = 'testimonial-author';
      author.textContent = testimonial.name;
      if (testimonial.role) {
        const role = document.createElement('small');
        role.textContent = testimonial.role;
        author.append(role);
      }
      card.append(avatar, quote, author);
      container.append(card);
    }
  } catch {
    return;
  }
}

async function loadFaqs() {
  const container = document.querySelector('[data-faq-list]');
  if (!container) return;
  try {
    const response = await fetch(`${api}/faqs`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { faqs } = await response.json();
    container.replaceChildren();
    if (!faqs.length) return;
    for (const faq of faqs) {
      const item = document.createElement('div');
      item.className = 'faq-item';
      const question = document.createElement('h3');
      question.textContent = faq.question;
      const answer = document.createElement('p');
      answer.textContent = faq.answer;
      item.append(question, answer);
      container.append(item);
    }
  } catch {
    return;
  }
}

async function loadGallery() {
  const container = document.querySelector('[data-gallery-grid]');
  if (!container) return;
  try {
    const response = await fetch(`${api}/gallery`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const { gallery } = await response.json();
    container.replaceChildren();
    if (!gallery.length) return;
    let currentGallery = null;
    let galleryGrid = null;
    for (const item of gallery) {
      const galleryName = item.gallery_name || 'Galeria geral';
      if (galleryName !== currentGallery) {
        currentGallery = galleryName;
        const group = document.createElement('section');
        group.className = 'gallery-group';
        addText(group, 'h3', 'gallery-group-title', galleryName);
        galleryGrid = document.createElement('div');
        galleryGrid.className = 'gallery-grid';
        group.append(galleryGrid);
        container.append(group);
      }
      const card = document.createElement('figure');
      card.className = 'gallery-item';
      const image = document.createElement('img');
      image.src = item.image_url;
      image.alt = item.title;
      image.loading = 'lazy';
      const caption = document.createElement('figcaption');
      caption.textContent = item.title;
      card.append(image, caption);
      galleryGrid.append(card);
    }
  } catch {
    return;
  }
}

function setPageMetadata({ title, description, image, type = 'website' }) {
  document.title = title;
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.content = description;
  const imageMeta = document.querySelector('meta[property="og:image"]') || document.createElement('meta');
  imageMeta.setAttribute('property', 'og:image');
  imageMeta.content = image || '';
  if (!imageMeta.isConnected) document.head.append(imageMeta);
  const titleMeta = document.querySelector('meta[property="og:title"]') || document.createElement('meta');
  titleMeta.setAttribute('property', 'og:title');
  titleMeta.content = title;
  if (!titleMeta.isConnected) document.head.append(titleMeta);
  const descriptionOg = document.querySelector('meta[property="og:description"]') || document.createElement('meta');
  descriptionOg.setAttribute('property', 'og:description');
  descriptionOg.content = description;
  if (!descriptionOg.isConnected) document.head.append(descriptionOg);
  const typeMeta = document.querySelector('meta[property="og:type"]') || document.createElement('meta');
  typeMeta.setAttribute('property', 'og:type');
  typeMeta.content = type;
  if (!typeMeta.isConnected) document.head.append(typeMeta);
}

function renderRichText(container, text) {
  container.replaceChildren();
  for (const paragraph of text.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean)) {
    addText(container, 'p', '', paragraph);
  }
}

async function loadBlogList() {
  const container = document.querySelector('[data-blog-list]');
  if (!container) return;
  try {
    const response = await fetch(`${api}/blog`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Não foi possível carregar os artigos agora.');
    const { posts } = await response.json();
    container.replaceChildren();
    if (!posts.length) {
      renderEmpty(container, 'Ainda não há artigos publicados');
      return;
    }
    for (const post of posts) {
      const card = document.createElement('article');
      card.className = 'content-card';
      if (post.image_url) {
        const image = document.createElement('img');
        image.src = post.image_url;
        image.alt = '';
        image.loading = 'lazy';
        image.className = 'content-card-image';
        card.append(image);
      }
      const body = document.createElement('div');
      body.className = 'content-card-body';
      addText(body, 'p', 'content-card-meta', post.published_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(post.published_at)) : 'Publicação');
      const title = document.createElement('h2');
      const titleLink = document.createElement('a');
      titleLink.href = `/artigo.html?slug=${encodeURIComponent(post.slug)}`;
      titleLink.textContent = post.title;
      title.append(titleLink);
      body.append(title);
      addText(body, 'p', 'content-card-copy', post.excerpt);
      const link = document.createElement('a');
      link.className = 'text-link';
      link.href = `/artigo.html?slug=${encodeURIComponent(post.slug)}`;
      link.textContent = 'Leia o artigo ↗';
      body.append(link);
      card.append(body);
      container.append(card);
    }
  } catch (error) {
    container.replaceChildren();
    addText(container, 'p', 'form-feedback is-error', error.message);
  }
}

async function loadBlogArticle() {
  const container = document.querySelector('[data-blog-detail]');
  if (!container) return;
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) {
    addText(container, 'p', 'form-feedback is-error', 'O artigo solicitado não foi informado.');
    return;
  }
  try {
    const response = await fetch(`${api}/blog/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar o artigo.');
    const { post } = result;
    container.replaceChildren();
    if (post.image_url) {
      const image = document.createElement('img');
      image.className = 'detail-hero-image';
      image.src = post.image_url;
      image.alt = '';
      image.fetchPriority = 'high';
      container.append(image);
    }
    addText(container, 'p', 'content-card-meta', post.published_at ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(post.published_at)) : 'Publicação');
    addText(container, 'h1', '', post.title);
    addText(container, 'p', 'detail-lead', post.excerpt);
    const content = document.createElement('div');
    content.className = 'article-content';
    renderRichText(content, post.content);
    container.append(content);
    setPageMetadata({ title: `${post.title} | Constelação Familiar`, description: post.excerpt, image: post.image_url, type: 'article' });
  } catch (error) {
    container.replaceChildren();
    addText(container, 'p', 'form-feedback is-error', error.message);
  }
}

async function loadActivityDetail() {
  const container = document.querySelector('[data-activity-detail]');
  if (!container) return;
  const parameters = new URLSearchParams(location.search);
  const kind = parameters.get('tipo') === 'evento' ? 'events' : 'courses';
  const backLink = document.querySelector('.detail-back');
  if (backLink && kind === 'events') {
    backLink.href = '/eventos.html';
    backLink.textContent = '← Voltar aos eventos';
  }
  const slug = parameters.get('slug');
  if (!slug) {
    addText(container, 'p', 'form-feedback is-error', 'A atividade solicitada não foi informada.');
    return;
  }
  try {
    const response = await fetch(`${api}/${kind}/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível carregar esta atividade.');
    const activity = result[kind === 'courses' ? 'course' : 'event'];
    container.replaceChildren();
    addText(container, 'p', 'eyebrow', kind === 'courses' ? 'Curso' : 'Evento');
    if (activity.category_name) addText(container, 'p', 'activity-category', activity.category_name);
    addText(container, 'h1', '', activity.title);
    addText(container, 'p', 'detail-lead', activity.short_description);
    if (activity.image_url) {
      const image = document.createElement('img');
      image.className = 'detail-hero-image';
      image.src = activity.image_url;
      image.alt = '';
      image.fetchPriority = 'high';
      container.append(image);
    }
    const details = document.createElement('dl');
    details.className = 'activity-details detail-activity-info';
    const information = [
      ['Data', activityDate(activity)],
      ['Formato', { in_person: 'Presencial', online: 'Online', hybrid: 'Híbrido' }[activity.modality] || 'A confirmar'],
      ['Local', activity.location || 'A confirmar'],
      ['Carga horária', activity.workload_hours ? `${activity.workload_hours} horas` : 'A confirmar'],
      ['Vagas disponíveis', activity.remaining_spots == null ? 'Consulte a equipe' : activity.remaining_spots],
      ['Investimento', activityPrice(activity)],
    ];
    for (const [label, value] of information) {
      const row = document.createElement('div');
      addText(row, 'dt', '', label);
      addText(row, 'dd', '', String(value));
      details.append(row);
    }
    container.append(details);
    const description = document.createElement('div');
    description.className = 'article-content';
    renderRichText(description, activity.description);
    container.append(description);
    if (kind === 'courses' && activity.modules?.length) {
      const curriculum = document.createElement('section');
      curriculum.className = 'course-curriculum';
      addText(curriculum, 'h2', '', 'Conteúdo programático');
      const moduleList = document.createElement('ol');
      for (const courseModule of activity.modules) {
        const item = document.createElement('li');
        const heading = document.createElement('div');
        addText(heading, 'h3', '', courseModule.title);
        if (courseModule.workload_hours) addText(heading, 'span', 'module-hours', `${courseModule.workload_hours} h`);
        item.append(heading);
        if (courseModule.description) addText(item, 'p', '', courseModule.description);
        moduleList.append(item);
      }
      curriculum.append(moduleList);
      container.append(curriculum);
    }
    if (activity.instructors?.length) {
      const instructorNames = activity.instructors.map((instructor) => instructor.name).join(' · ');
      addText(container, 'p', 'activity-instructors', `Com ${instructorNames}`);
    }
    if (activity.status === 'enrollments_open') {
      const enrollment = document.createElement('a');
      enrollment.className = 'button button-primary';
      enrollment.href = `/inscricao.html?tipo=${kind === 'courses' ? 'curso' : 'evento'}&id=${encodeURIComponent(activity.id)}`;
      enrollment.textContent = 'Quero me inscrever ↗';
      container.append(enrollment);
    } else {
      addText(container, 'p', 'activity-status', 'Inscrições em breve');
    }
    setPageMetadata({ title: `${activity.title} | Constelação Familiar`, description: activity.short_description, image: activity.image_url });
  } catch (error) {
    container.replaceChildren();
    addText(container, 'p', 'form-feedback is-error', error.message);
  }
}

document.querySelectorAll('[data-activity-list]').forEach((container) => {
  renderActivityList(container, container.dataset.activityList);
});

document.querySelectorAll('[data-featured-activities]').forEach(loadFeaturedActivities);
document.querySelectorAll('[data-contact-form]').forEach(setupContactForm);
document.querySelectorAll('[data-enrollment-form]').forEach(setupEnrollmentForm);
if (document.querySelector('[data-site-setting]')) loadPublicSettings();
if (document.querySelector('[data-public-instructors]')) loadPublicInstructors();
if (document.querySelector('[data-blog-preview]')) loadBlogPreview();
if (document.querySelector('[data-testimonials-list]')) loadTestimonials();
if (document.querySelector('[data-faq-list]')) loadFaqs();
if (document.querySelector('[data-gallery-grid]')) loadGallery();
if (document.querySelector('[data-blog-list]')) loadBlogList();
if (document.querySelector('[data-blog-detail]')) loadBlogArticle();
if (document.querySelector('[data-activity-detail]')) loadActivityDetail();