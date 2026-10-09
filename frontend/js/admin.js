const apiBase = '/api/v1';
const tokenKey = 'constelacao-admin-token';
const statusLabels = {
  draft: 'Rascunho',
  published: 'Publicado',
  enrollments_open: 'Inscrições abertas',
  enrollments_closed: 'Inscrições encerradas',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
  new: 'Novo',
  contacted: 'Contato realizado',
  awaiting_payment: 'Aguardando pagamento',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  in_progress: 'Em atendimento',
  replied: 'Respondido',
  closed: 'Encerrado',
};
const statusOptions = {
  activities: ['draft', 'published', 'enrollments_open', 'enrollments_closed', 'ended', 'cancelled'],
  enrollments: ['new', 'contacted', 'awaiting_payment', 'confirmed', 'cancelled', 'completed'],
  contacts: ['new', 'in_progress', 'replied', 'closed'],
};
const accessScreen = document.querySelector('[data-access-screen]');
const adminShell = document.querySelector('[data-admin-shell]');
const adminView = document.querySelector('[data-admin-view]');
const notice = document.querySelector('[data-admin-notice]');
let currentUser;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showFeedback(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle('is-error', isError);
  target.classList.toggle('is-success', !isError && Boolean(message));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = sessionStorage.getItem(tokenKey);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${apiBase}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    sessionStorage.removeItem(tokenKey);
    showAccessScreen();
  }
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
  return result;
}

function showAccessScreen() {
  accessScreen.hidden = false;
  adminShell.hidden = true;
  currentUser = null;
}

async function showAdminShell(user) {
  currentUser = user;
  accessScreen.hidden = true;
  adminShell.hidden = false;
  document.querySelector('[data-admin-user]').textContent = user.name;
  await loadView('dashboard');
}

function setNotice(message, isError = false) {
  showFeedback(notice, message, isError);
}

function setAccessView(viewName) {
  document.querySelector('[data-login-view]').hidden = viewName !== 'login';
  document.querySelector('[data-setup-view]').hidden = viewName !== 'setup';
}

function setHeading(title, subtitle, action) {
  const heading = node('div', 'view-heading');
  const text = node('div');
  text.append(node('h1', '', title), node('p', '', subtitle));
  heading.append(text);
  if (action) heading.append(action);
  return heading;
}

function metric(label, value) {
  const item = node('div', 'metric-item');
  item.append(node('p', 'metric-label', label), node('p', 'metric-value', String(value ?? 0)));
  return item;
}

async function loadDashboard() {
  const result = await api('/admin/dashboard');
  const metrics = result.metrics;
  adminView.replaceChildren(
    setHeading('Visão geral', 'Resumo atualizado do site e do atendimento.'),
  );
  const grid = node('div', 'metrics-grid');
  grid.append(
    metric('Cursos cadastrados', metrics.courses),
    metric('Eventos cadastrados', metrics.events),
    metric('Inscrições recebidas', metrics.enrollments),
    metric('Novos contatos', metrics.new_contacts),
  );
  adminView.append(grid);
  const foot = node('section', 'dashboard-foot');
  foot.append(
    node('h2', '', 'Acompanhe as solicitações recentes'),
    node('p', '', `${metrics.new_enrollments ?? 0} inscrição(ões) aguardando atendimento. Revise os dados enviados antes de entrar em contato.`),
  );
  adminView.append(foot);
}

function statusPill(status) {
  return node('span', `status-pill${status === 'enrollments_open' || status === 'confirmed' ? ' is-open' : ''}`, statusLabels[status] || status);
}

function table(headers, rows) {
  const wrapper = node('div', 'table-wrap');
  const tableElement = node('table', 'admin-table');
  const head = node('thead');
  const headRow = node('tr');
  for (const label of headers) headRow.append(node('th', '', label));
  head.append(headRow);
  const body = node('tbody');
  for (const row of rows) body.append(row);
  tableElement.append(head, body);
  wrapper.append(tableElement);
  return wrapper;
}

function dateLabel(value) {
  if (!value) return 'A confirmar';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'A confirmar' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function localDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function newButton(text, className, onClick) {
  const button = node('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

async function loadActivities(resource) {
  const name = resource === 'courses' ? 'curso' : 'evento';
  const plural = resource === 'courses' ? 'cursos' : 'eventos';
  setNotice('');
  try {
    const result = await api(`/admin/${resource}`);
    const editor = node('section', 'editor-section');
    const editorHeading = node('div', 'editor-heading');
    editorHeading.append(node('h2', '', 'Novo cadastro'));
    editor.append(editorHeading, activityForm(resource));
    const create = newButton(`Novo ${name}`, 'secondary-button is-primary', () => {
      editor.hidden = false;
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    adminView.replaceChildren(setHeading(plural[0].toUpperCase() + plural.slice(1), 'Crie, edite ou arquive itens sem alterar o código do site.', create));
    if (result[resource].length === 0) {
      const empty = node('p', 'empty-state', `Nenhum ${name} cadastrado ainda. Use “Novo ${name}” para começar.`);
      adminView.append(empty);
    } else {
      adminView.append(table(
        ['Título', 'Data', 'Vagas', 'Status', 'Ações'],
        result[resource].map((item) => activityRow(resource, item, editor)),
      ));
    }
    editor.hidden = true;
    adminView.append(editor);
  } catch (error) {
    adminView.replaceChildren(setHeading(plural, 'Acesso restrito por permissões.'));
    adminView.append(node('p', 'empty-state', error.message));
  }
}

async function loadCourseCategories(select, selectedId = '') {
  try {
    const result = await api('/admin/course-categories');
    select.replaceChildren();
    const noCategory = node('option', '', 'Sem categoria');
    noCategory.value = '';
    select.append(noCategory);
    for (const category of result.categories.filter((item) => item.active || item.id === selectedId)) {
      const option = node('option', '', `${category.name}${category.active ? '' : ' (inativa — vínculo existente)'}`);
      option.value = category.id;
      option.selected = category.id === selectedId;
      select.append(option);
    }
    return true;
  } catch (error) {
    setNotice(error.message, true);
    return false;
  }
}

function categoryForm(category, onSaved) {
  const form = node('form', 'editor-form');
  const name = addField(form, 'Nome', 'name', 'text', { required: true, minLength: 2, maxLength: 120 });
  const slug = addField(form, 'Endereço amigável', 'slug', 'text', { required: true, maxLength: 140 });
  const description = addField(form, 'Descrição', 'description', 'textarea', { maxLength: 500, wide: true });
  let slugEdited = Boolean(category);
  slug.addEventListener('input', () => { slugEdited = true; });
  name.addEventListener('input', () => {
    if (!slugEdited) slug.value = slugify(name.value);
  });
  if (category) {
    name.value = category.name;
    slug.value = category.slug;
    description.value = category.description || '';
  }
  const actions = node('div', 'editor-actions');
  const save = node('button', 'admin-button button-primary', category ? 'Salvar categoria' : 'Criar categoria');
  save.type = 'submit';
  actions.append(save, newButton('Cancelar', 'secondary-button', onSaved));
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    try {
      await api(`/admin/course-categories${category ? `/${category.id}` : ''}`, {
        method: category ? 'PUT' : 'POST',
        body: JSON.stringify({ name: name.value, slug: slug.value, description: description.value }),
      });
      await onSaved();
      setNotice(category ? 'Categoria atualizada.' : 'Categoria criada.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });
  return form;
}

async function loadCourseCategoriesView() {
  try {
    const { categories } = await api('/admin/course-categories');
    const createForm = node('section', 'editor-section');
    createForm.append(node('div', 'editor-heading', 'Nova categoria'), categoryForm(null, loadCourseCategoriesView));
    const create = newButton('Nova categoria', 'secondary-button is-primary', () => {
      createForm.hidden = false;
      createForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    adminView.replaceChildren(setHeading('Categorias de cursos', 'Organize os cursos por temas; desativar preserva os vínculos existentes.', create));
    if (!categories.length) adminView.append(node('p', 'empty-state', 'Nenhuma categoria criada ainda.'));
    else {
      const rows = categories.map((category) => {
        const row = node('tr');
        row.append(node('td', '', category.name), node('td', '', category.slug), node('td', '', category.description || '—'));
        const active = node('td');
        active.append(statusPill(category.active ? 'published' : 'cancelled'));
        const actions = node('td');
        actions.append(newButton('Editar', 'row-button', () => {
          const editor = node('section', 'editor-section');
          editor.append(node('div', 'editor-heading', `Editar: ${category.name}`), categoryForm(category, loadCourseCategoriesView));
          createForm.replaceWith(editor);
          editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
        actions.append(newButton(category.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
          try {
            await api(`/admin/course-categories/${category.id}/active`, {
              method: 'PATCH',
              body: JSON.stringify({ active: !category.active }),
            });
            await loadCourseCategoriesView();
            setNotice(category.active ? 'Categoria desativada; cursos vinculados foram preservados.' : 'Categoria ativada.');
          } catch (error) {
            setNotice(error.message, true);
          }
        }));
        row.append(active, actions);
        return row;
      });
      adminView.append(table(['Categoria', 'Slug', 'Descrição', 'Estado', 'Ações'], rows));
    }
    createForm.hidden = true;
    adminView.append(createForm);
  } catch (error) {
    adminView.replaceChildren(setHeading('Categorias de cursos', 'Gerencie a classificação dos cursos.'), node('p', 'empty-state', error.message));
  }
}

function courseModuleForm(courseId, module, refresh) {
  const form = node('form', 'editor-form');
  const title = addField(form, 'Título do módulo', 'title', 'text', { required: true, minLength: 2, maxLength: 180 });
  const position = addField(form, 'Ordem', 'position', 'number', { required: true, min: 1, max: 500, step: 1 });
  const workloadHours = addField(form, 'Carga horária (opcional)', 'workloadHours', 'number', { min: 1, max: 10000, step: 1 });
  const description = addField(form, 'Descrição', 'description', 'textarea', { maxLength: 4000, wide: true, rows: 4 });
  if (module) {
    title.value = module.title;
    position.value = String(module.position);
    workloadHours.value = module.workload_hours ?? '';
    description.value = module.description || '';
  }
  const actions = node('div', 'editor-actions');
  const save = node('button', 'admin-button button-primary', module ? 'Salvar módulo' : 'Adicionar módulo');
  save.type = 'submit';
  actions.append(save);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    try {
      await api(`/admin/courses/${courseId}/modules${module ? `/${module.id}` : ''}`, {
        method: module ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: title.value,
          description: description.value,
          position: Number(position.value),
          workloadHours: workloadHours.value ? Number(workloadHours.value) : null,
          active: module?.active ?? true,
        }),
      });
      await refresh();
      setNotice(module ? 'Módulo atualizado.' : 'Módulo adicionado.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });
  return form;
}

async function loadModulesForCourse(courseId, select, list, editor) {
  if (!courseId) {
    list.replaceChildren(node('p', 'empty-state', 'Selecione um curso para gerenciar seus módulos.'));
    editor.hidden = true;
    return;
  }
  try {
    const { modules } = await api(`/admin/courses/${courseId}/modules`);
    const rows = modules.map((module) => {
      const row = node('tr');
      row.append(node('td', '', String(module.position)), node('td', '', module.title),
        node('td', '', module.workload_hours ? `${module.workload_hours} h` : '—'));
      const state = node('td');
      state.append(statusPill(module.active ? 'published' : 'cancelled'));
      const actions = node('td');
      actions.append(newButton('Editar', 'row-button', () => {
        editor.replaceChildren(node('div', 'editor-heading', `Editar módulo: ${module.title}`), courseModuleForm(courseId, module, refresh));
        editor.hidden = false;
      }));
      actions.append(newButton(module.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
        try {
          await api(`/admin/courses/${courseId}/modules/${module.id}/active`, {
            method: 'PATCH',
            body: JSON.stringify({ active: !module.active }),
          });
          await refresh();
          setNotice(module.active ? 'Módulo desativado.' : 'Módulo ativado.');
        } catch (error) {
          setNotice(error.message, true);
        }
      }));
      row.append(state, actions);
      return row;
    });
    list.replaceChildren(...(rows.length
      ? [table(['Ordem', 'Módulo', 'Carga horária', 'Estado', 'Ações'], rows)]
      : [node('p', 'empty-state', 'Este curso ainda não possui módulos.')]));
    editor.replaceChildren(node('div', 'editor-heading', 'Novo módulo'), courseModuleForm(courseId, null, refresh));
    editor.hidden = false;
  } catch (error) {
    list.replaceChildren(node('p', 'empty-state', error.message));
  }

  async function refresh() {
    await loadModulesForCourse(courseId, select, list, editor);
  }
}

async function loadCourseModulesView() {
  try {
    const { courses } = await api('/admin/courses');
    adminView.replaceChildren(setHeading('Módulos de cursos', 'Cadastre o conteúdo programático, a ordem e a carga horária de cada módulo.'));
    if (!courses.length) {
      adminView.append(node('p', 'empty-state', 'Cadastre um curso antes de adicionar módulos.'));
      return;
    }
    const picker = node('label', 'module-course-picker');
    picker.append(document.createTextNode('Curso'));
    const select = node('select');
    select.setAttribute('aria-label', 'Curso para gerenciar módulos');
    for (const course of courses) {
      const option = node('option', '', course.title);
      option.value = course.id;
      select.append(option);
    }
    picker.append(select);
    const list = node('div');
    const editor = node('section', 'editor-section');
    adminView.append(picker, list, editor);
    const changeCourse = () => loadModulesForCourse(select.value, select, list, editor);
    select.addEventListener('change', changeCourse);
    await changeCourse();
  } catch (error) {
    adminView.replaceChildren(setHeading('Módulos de cursos', 'Gerencie módulos e cargas horárias.'), node('p', 'empty-state', error.message));
  }
}

function activityRow(resource, activity, editor) {
  const row = node('tr');
  const title = node('td');
  title.append(node('strong', '', activity.title), node('small', '', activity.slug));
  const date = node('td', '', dateLabel(activity.starts_at));
  const spots = node('td', '', activity.available_spots == null ? 'Sem limite' : `${activity.enrolled_count}/${activity.available_spots}`);
  const status = node('td');
  status.append(statusPill(activity.status));
  const actions = node('td');
  const actionGroup = node('div', 'table-actions');
  actionGroup.append(
    newButton('Editar', 'row-button', () => openActivityEditor(resource, activity, editor)),
    newButton('Arquivar', 'row-button is-danger', async () => {
      if (!confirm(`Arquivar “${activity.title}”? O registro será preservado.`)) return;
      try {
        await api(`/admin/${resource}/${activity.id}`, { method: 'DELETE' });
        await loadActivities(resource);
        setNotice(`${resource === 'courses' ? 'Curso' : 'Evento'} arquivado.`);
      } catch (error) {
        setNotice(error.message, true);
      }
    }),
  );
  actions.append(actionGroup);
  row.append(title, date, spots, status, actions);
  return row;
}

function addField(form, labelText, name, type = 'text', options = {}) {
  const wrapper = node('label', options.wide ? 'wide' : '');
  wrapper.append(document.createTextNode(labelText));
  let field;
  if (type === 'select') {
    field = node('select');
    field.multiple = Boolean(options.multiple);
    for (const [value, label] of options.choices) {
      const option = node('option', '', label);
      option.value = value;
      field.append(option);
    }
  } else if (type === 'textarea') {
    field = node('textarea');
    field.rows = options.rows || 3;
  } else {
    field = node('input');
    field.type = type;
  }
  field.name = name;
  if (type === 'checkbox') field.checked = Boolean(options.checked);
  if (options.required) field.required = true;
  if (options.minLength) field.minLength = options.minLength;
  if (options.maxLength) field.maxLength = options.maxLength;
  if (options.autocomplete) field.autocomplete = options.autocomplete;
  if (options.step) field.step = options.step;
  if (options.min !== undefined) field.min = options.min;
  if (options.max !== undefined) field.max = options.max;
  if (options.placeholder) field.placeholder = options.placeholder;
  wrapper.append(field);
  form.append(wrapper);
  return field;
}

function addImageUpload(form, targetInput) {
  const wrapper = node('div', 'image-upload-field wide');
  const label = node('label', '', 'Enviar imagem (JPEG, PNG ou WebP; até 8 MB)');
  const file = node('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp';
  file.id = `${targetInput.name}-upload`;
  label.htmlFor = file.id;
  const upload = newButton('Enviar imagem', 'secondary-button', async () => {
    if (!file.files?.[0]) {
      showFeedback(feedback, 'Selecione uma imagem antes de enviar.', true);
      return;
    }
    const data = new FormData();
    data.append('file', file.files[0]);
    upload.disabled = true;
    showFeedback(feedback, 'Enviando imagem...');
    try {
      const result = await api('/admin/uploads', { method: 'POST', body: data });
      targetInput.value = result.file.url;
      file.value = '';
      showFeedback(feedback, 'Imagem enviada e vinculada ao cadastro.');
    } catch (error) {
      showFeedback(feedback, error.message, true);
    } finally {
      upload.disabled = false;
    }
  });
  const feedback = node('p', 'access-feedback');
  feedback.setAttribute('role', 'status');
  label.append(file);
  wrapper.append(label, upload, feedback);
  form.append(wrapper);
}

function activityForm(resource, activity) {
  const form = node('form', 'editor-form');
  let instructorOptionsReady = Promise.resolve();
  let categoryOptionsReady = Promise.resolve();
  const fields = [
    ['Nome', 'title', 'text', { required: true, minLength: 3, maxLength: 180 }],
    ['Endereço amigável', 'slug', 'text', { required: true, maxLength: 200 }],
    ['Descrição curta', 'shortDescription', 'text', { required: true, minLength: 3, maxLength: 300 }],
    ['Descrição completa', 'description', 'textarea', { required: true, minLength: 3, maxLength: 20000, wide: true, rows: 5 }],
    ['Imagem (URL ou arquivo enviado)', 'imageUrl', 'text', { maxLength: 2000, wide: true, placeholder: 'https://... ou envie uma imagem abaixo' }],
    ['Modalidade', 'modality', 'select', { required: true, choices: [['in_person', 'Presencial'], ['online', 'Online'], ['hybrid', 'Híbrido']] }],
    ['Início', 'startsAt', 'datetime-local', {}],
    ['Término', 'endsAt', 'datetime-local', {}],
    ['Local ou plataforma', 'location', 'text', { maxLength: 180 }],
    ['Vagas (vazio = sem limite)', 'availableSpots', 'number', { min: 0, step: 1 }],
    ['Valor (R$)', 'price', 'number', { min: 0, step: '0.01' }],
    ['Valor promocional (R$)', 'promotionalPrice', 'number', { min: 0, step: '0.01' }],
    ['Status', 'status', 'select', { required: true, choices: statusOptions.activities.map((status) => [status, statusLabels[status]]) }],
  ];
  if (resource === 'courses') {
    fields.splice(9, 0, ['Carga horária', 'workloadHours', 'number', { min: 1, step: 1 }]);
    fields.splice(10, 0, ['Instrutores', 'instructorIds', 'select', { multiple: true, choices: [], wide: true }]);
    fields.splice(9, 0, ['Categoria', 'categoryId', 'select', { choices: [['', 'Sem categoria']] }]);
  }
  const controls = new Map();
  for (const [label, fieldName, type, options] of fields) controls.set(fieldName, addField(form, label, fieldName, type, options));
  addImageUpload(form, controls.get('imageUrl'));
  if (resource === 'courses') {
    instructorOptionsReady = loadInstructorOptions(controls.get('instructorIds'), activity?.instructor_ids || []);
    categoryOptionsReady = loadCourseCategories(controls.get('categoryId'), activity?.category_id || '');
  }

  const slug = controls.get('slug');
  let slugWasEdited = Boolean(activity);
  slug.addEventListener('input', () => { slugWasEdited = true; });
  controls.get('title').addEventListener('input', (event) => {
    if (!slugWasEdited) slug.value = slugify(event.target.value);
  });

  const save = node('button', 'admin-button button-primary', activity ? 'Salvar alterações' : `Criar ${resource === 'courses' ? 'curso' : 'evento'}`);
  save.type = 'submit';
  const cancel = newButton('Cancelar', 'secondary-button', () => {
    if (activity) loadActivities(resource);
    else form.reset();
  });
  const actions = node('div', 'editor-actions');
  actions.append(save, cancel);
  form.append(actions);

  if (activity) {
    for (const [key, control] of controls) {
      let value = activity[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
      if (key === 'price') value = activity.price_cents == null ? '' : (activity.price_cents / 100).toFixed(2);
      if (key === 'promotionalPrice') value = activity.promotional_price_cents == null ? '' : (activity.promotional_price_cents / 100).toFixed(2);
      if (key === 'startsAt') value = dateTimeLocal(activity.starts_at);
      if (key === 'endsAt') value = dateTimeLocal(activity.ends_at);
      if (key === 'shortDescription') value = activity.short_description;
      if (key === 'imageUrl') value = activity.image_url || '';
      if (key === 'workloadHours') value = activity.workload_hours ?? '';
      if (key === 'categoryId') value = activity.category_id ?? '';
      if (key === 'availableSpots') value = activity.available_spots ?? '';
      if (key === 'instructorIds') continue;
      if (key === 'price' || key === 'promotionalPrice') {
        control.value = value;
        continue;
      }
      control.value = value ?? '';
    }
  } else {
    controls.get('status').value = 'draft';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    await instructorOptionsReady;
    if (!(await categoryOptionsReady)) return;
    const raw = Object.fromEntries(new FormData(form));
    const cents = (value) => value === '' ? null : Math.round(Number(value) * 100);
    const integer = (value) => value === '' ? null : Number(value);
    const isoDate = (value) => value ? new Date(value).toISOString() : null;
    const body = {
      title: raw.title,
      slug: raw.slug,
      shortDescription: raw.shortDescription,
      description: raw.description,
      imageUrl: raw.imageUrl || null,
      modality: raw.modality,
      startsAt: isoDate(raw.startsAt),
      endsAt: isoDate(raw.endsAt),
      location: raw.location || null,
      availableSpots: integer(raw.availableSpots),
      priceCents: cents(raw.price),
      promotionalPriceCents: cents(raw.promotionalPrice),
      status: raw.status,
    };
    if (resource === 'courses') {
      body.workloadHours = integer(raw.workloadHours);
      body.instructorIds = [...controls.get('instructorIds').selectedOptions].map((option) => option.value);
      body.categoryId = raw.categoryId || null;
    }

    save.disabled = true;
    setNotice('Salvando cadastro...');
    try {
      const saved = await api(`/admin/${resource}${activity ? `/${activity.id}` : ''}`, {
        method: activity ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (resource === 'courses') {
        const courseId = activity?.id || saved.course.id;
        await api(`/admin/courses/${courseId}/instructors`, {
          method: 'PUT',
          body: JSON.stringify({ instructorIds: body.instructorIds }),
        });
      }
      await loadActivities(resource);
      setNotice(activity ? 'Alterações salvas.' : 'Cadastro criado.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });

  return form;
}

function openActivityEditor(resource, activity, oldEditor) {
  const newEditor = node('section', 'editor-section');
  const heading = node('div', 'editor-heading');
  heading.append(node('h2', '', `Editar: ${activity.title}`));
  newEditor.append(heading, activityForm(resource, activity));
  oldEditor.replaceWith(newEditor);
  newEditor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterControls(resource, records = []) {
  const row = node('div', 'filter-row');
  const search = node('input', 'filter-control');
  search.type = 'search';
  search.placeholder = resource === 'enrollments' ? 'Buscar por nome, e-mail, telefone ou atividade' : 'Buscar por nome, e-mail ou assunto';
  search.setAttribute('aria-label', 'Buscar registros');
  const status = node('select', 'filter-control');
  status.setAttribute('aria-label', 'Filtrar por status');
  status.append(node('option', '', 'Todos os status'));
  status.firstElementChild.value = '';
  for (const value of statusOptions[resource]) {
    const option = node('option', '', statusLabels[value]);
    option.value = value;
    status.append(option);
  }
  const controls = [search, status];
  let activity;
  let from;
  let to;
  if (resource === 'enrollments') {
    const type = node('select', 'filter-control');
    type.setAttribute('aria-label', 'Filtrar por tipo de atividade');
    const allTypes = node('option', '', 'Cursos e eventos');
    allTypes.value = '';
    type.append(allTypes);
    for (const [value, label] of [['course', 'Cursos'], ['event', 'Eventos']]) {
      const option = node('option', '', label);
      option.value = value;
      type.append(option);
    }
    activity = node('select', 'filter-control');
    activity.setAttribute('aria-label', 'Filtrar por curso ou evento');
    const allActivities = node('option', '', 'Todas as atividades');
    allActivities.value = '';
    activity.append(allActivities);
    for (const title of [...new Set(records.map((record) => record.activity_title).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'pt-BR'))) {
      const option = node('option', '', title);
      option.value = title;
      activity.append(option);
    }
    from = node('input', 'filter-control');
    from.type = 'date';
    from.setAttribute('aria-label', 'Inscrições a partir da data');
    to = node('input', 'filter-control');
    to.type = 'date';
    to.setAttribute('aria-label', 'Inscrições até a data');
    controls.push(type, activity, from, to);
    type.addEventListener('change', () => {
      for (const option of activity.options) {
        const hasMatchingType = records.some((record) => record.activity_title === option.value && record.activity_type === type.value);
        option.hidden = Boolean(option.value) && Boolean(type.value) && !hasMatchingType;
      }
      if (activity.selectedOptions[0]?.hidden) activity.value = '';
      apply();
    });
    activity.addEventListener('change', apply);
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
  }
  const apply = () => {
    for (const tableRow of adminView.querySelectorAll('tbody tr')) {
      const matchesText = tableRow.dataset.search.includes(search.value.trim().toLowerCase());
      const matchesStatus = !status.value || tableRow.dataset.status === status.value;
      const matchesType = !activity || !controls[2].value || tableRow.dataset.type === controls[2].value;
      const matchesActivity = !activity || !activity.value || tableRow.dataset.activity === activity.value;
      const recordDate = tableRow.dataset.date;
      const matchesFrom = !from?.value || recordDate >= from.value;
      const matchesTo = !to?.value || recordDate <= to.value;
      tableRow.hidden = !(matchesText && matchesStatus && matchesType && matchesActivity && matchesFrom && matchesTo);
    }
  };
  search.addEventListener('input', apply);
  status.addEventListener('change', apply);
  row.append(...controls);
  if (resource === 'enrollments') {
    const exportButton = newButton('Exportar CSV', 'secondary-button', () => {
      const filtered = records.filter((record) => {
        const text = `${record.name} ${record.email} ${record.phone || ''} ${record.activity_title || ''}`.toLowerCase();
        const date = localDateKey(record.created_at);
        return text.includes(search.value.trim().toLowerCase())
          && (!status.value || record.status === status.value)
          && (!controls[2].value || record.activity_type === controls[2].value)
          && (!activity.value || record.activity_title === activity.value)
          && (!from.value || date >= from.value)
          && (!to.value || date <= to.value);
      });
      const columns = ['Nome', 'E-mail', 'Telefone', 'Cidade', 'Estado', 'Curso ou evento', 'Tipo', 'Data da inscrição', 'Status'];
      const escapeCell = (value) => {
        let text = String(value ?? '');
        if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const lines = [
        columns,
        ...filtered.map((record) => [
          record.name, record.email, record.phone, record.city, record.state,
          record.activity_title, record.activity_type === 'course' ? 'Curso' : 'Evento',
          record.created_at ? new Date(record.created_at).toLocaleString('pt-BR') : '',
          statusLabels[record.status] || record.status,
        ]),
      ].map((values) => values.map(escapeCell).join(';'));
      const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = node('a');
      link.href = url;
      link.download = `inscricoes-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`${filtered.length} inscrição(ões) exportada(s).`);
    });
    row.append(exportButton);
  }
  return row;
}

function updateStatusSelect(resource, id, select) {
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await api(`/admin/${resource}/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: select.value }),
      });
      setNotice('Status atualizado.');
    } catch (error) {
      setNotice(error.message, true);
      await loadView(resource);
    } finally {
      select.disabled = false;
    }
  });
}

async function loadInstructorOptions(select, selectedIds) {
  if (!select) return;
  select.disabled = true;
  try {
    const result = await api('/admin/instructors');
    for (const instructor of result.instructors.filter((item) => item.active)) {
      const option = node('option', '', instructor.name);
      option.value = instructor.id;
      option.selected = selectedIds.includes(instructor.id);
      select.append(option);
    }
  } catch (error) {
    setNotice(error.message, true);
  } finally {
    select.disabled = false;
  }
}

function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function instructorForm(instructor) {
  const form = node('form', 'editor-form');
  const fields = [
    ['Nome', 'name', 'text', { required: true, minLength: 2, maxLength: 120 }],
    ['Endereço amigável', 'slug', 'text', { required: true, maxLength: 140 }],
    ['Formação', 'qualifications', 'textarea', { maxLength: 2000 }],
    ['Especialidades', 'specialties', 'textarea', { maxLength: 2000 }],
    ['Biografia', 'biography', 'textarea', { maxLength: 10000, wide: true, rows: 5 }],
    ['URL da foto ou arquivo enviado', 'photoUrl', 'text', { maxLength: 2000, wide: true }],
    ['E-mail', 'email', 'email', { maxLength: 254 }],
    ['Instagram', 'instagramUrl', 'url', { maxLength: 2000 }],
    ['Site pessoal', 'websiteUrl', 'url', { maxLength: 2000 }],
  ];
  const controls = new Map();
  for (const [label, name, type, options] of fields) controls.set(name, addField(form, label, name, type, options));
  addImageUpload(form, controls.get('photoUrl'));
  let slugWasEdited = Boolean(instructor);
  controls.get('slug').addEventListener('input', () => { slugWasEdited = true; });
  controls.get('name').addEventListener('input', (event) => {
    if (!slugWasEdited) controls.get('slug').value = slugify(event.target.value);
  });

  const actions = node('div', 'editor-actions');
  const save = node('button', 'admin-button button-primary', instructor ? 'Salvar alterações' : 'Cadastrar instrutor');
  save.type = 'submit';
  const cancel = newButton('Cancelar', 'secondary-button', () => loadInstructors());
  actions.append(save, cancel);
  form.append(actions);

  if (instructor) {
    for (const [name, control] of controls) {
      const key = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      control.value = instructor[key] || '';
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(form));
    const body = {
      ...raw,
      biography: raw.biography || '',
      qualifications: raw.qualifications || '',
      specialties: raw.specialties || '',
      photoUrl: raw.photoUrl || null,
      instagramUrl: raw.instagramUrl || null,
      websiteUrl: raw.websiteUrl || null,
      email: raw.email || null,
      active: instructor?.active ?? true,
    };
    save.disabled = true;
    try {
      await api(`/admin/instructors${instructor ? `/${instructor.id}` : ''}`, {
        method: instructor ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      await loadInstructors();
      setNotice(instructor ? 'Instrutor atualizado.' : 'Instrutor cadastrado.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });
  return form;
}

function instructorRow(instructor) {
  const row = node('tr');
  const name = node('td');
  name.append(node('strong', '', instructor.name), node('small', '', instructor.email || instructor.slug));
  const qualifications = node('td', '', instructor.qualifications || 'Não informada');
  const status = node('td');
  status.append(statusPill(instructor.active ? 'published' : 'cancelled'));
  const actions = node('td');
  const group = node('div', 'table-actions');
  group.append(newButton('Editar', 'row-button', () => {
    const editor = node('section', 'editor-section');
    editor.append(node('div', 'editor-heading', `Editar: ${instructor.name}`), instructorForm(instructor));
    adminView.append(editor);
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  group.append(newButton(instructor.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
    try {
      await api(`/admin/instructors/${instructor.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !instructor.active }),
      });
      await loadInstructors();
      setNotice(instructor.active ? 'Instrutor desativado.' : 'Instrutor ativado.');
    } catch (error) {
      setNotice(error.message, true);
    }
  }));
  actions.append(group);
  row.append(name, qualifications, status, actions);
  return row;
}

async function loadInstructors() {
  try {
    const result = await api('/admin/instructors');
    const editor = node('section', 'editor-section');
    editor.append(node('div', 'editor-heading', 'Novo instrutor'), instructorForm());
    const create = newButton('Novo instrutor', 'secondary-button is-primary', () => {
      editor.hidden = false;
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    adminView.replaceChildren(setHeading('Instrutores', 'Cadastre profissionais e vincule-os aos cursos.', create));
    if (result.instructors.length === 0) adminView.append(node('p', 'empty-state', 'Nenhum instrutor cadastrado ainda.'));
    else adminView.append(table(['Instrutor', 'Formação', 'Estado', 'Ações'], result.instructors.map(instructorRow)));
    editor.hidden = true;
    adminView.append(editor);
  } catch (error) {
    adminView.replaceChildren(setHeading('Instrutores', 'Acesso restrito por permissões.'), node('p', 'empty-state', error.message));
  }
}

const settingDefinitions = [
  ['Nome do site', 'siteName', 'text', { required: true, maxLength: 120 }],
  ['Frase de apoio', 'tagline', 'text', { maxLength: 240 }],
  ['Título principal', 'bannerTitle', 'text', { maxLength: 180 }],
  ['Texto principal', 'bannerSubtitle', 'textarea', { maxLength: 500, wide: true }],
  ['Imagem do banner (URL ou arquivo enviado)', 'bannerImageUrl', 'text', { maxLength: 2000, wide: true }],
  ['E-mail de contato', 'contactEmail', 'email', { maxLength: 254 }],
  ['E-mail para notificações administrativas', 'notificationAdminEmail', 'email', { maxLength: 254 }],
  ['Assunto do e-mail para a equipe', 'enrollmentAdminSubject', 'text', { maxLength: 180, wide: true }],
  ['Mensagem para a equipe', 'enrollmentAdminMessage', 'textarea', { maxLength: 4000, wide: true, rows: 5 }],
  ['Assunto do e-mail de confirmação', 'enrollmentCustomerSubject', 'text', { maxLength: 180, wide: true }],
  ['Mensagem de confirmação ao participante', 'enrollmentCustomerMessage', 'textarea', { maxLength: 4000, wide: true, rows: 5 }],
  ['Ativar envio de e-mails SMTP', 'smtpEnabled', 'checkbox', { wide: true }],
  ['Servidor SMTP', 'smtpHost', 'text', { maxLength: 255, placeholder: 'smtp.exemplo.com' }],
  ['Porta SMTP', 'smtpPort', 'number', { min: 1, max: 65535, step: 1 }],
  ['Conexão segura (TLS)', 'smtpSecure', 'checkbox'],
  ['Usuário SMTP', 'smtpUser', 'text', { maxLength: 254 }],
  ['E-mail remetente', 'smtpFrom', 'email', { maxLength: 254 }],
  ['Senha SMTP (deixe em branco para manter a senha atual)', 'smtpPassword', 'password', { maxLength: 512, autocomplete: 'new-password', wide: true }],
  ['Telefone', 'phone', 'tel', { maxLength: 30 }],
  ['WhatsApp', 'whatsappNumber', 'tel', { maxLength: 30 }],
  ['Mensagem padrão do WhatsApp', 'whatsappMessage', 'text', { maxLength: 300 }],
  ['Endereço', 'address', 'text', { maxLength: 300, wide: true }],
  ['Instagram (URL)', 'instagramUrl', 'url', { maxLength: 2000 }],
  ['Facebook (URL)', 'facebookUrl', 'url', { maxLength: 2000 }],
  ['TikTok (URL)', 'tiktokUrl', 'url', { maxLength: 2000 }],
  ['YouTube (URL)', 'youtubeUrl', 'url', { maxLength: 2000 }],
  ['LinkedIn (URL)', 'linkedinUrl', 'url', { maxLength: 2000 }],
  ['Título SEO padrão', 'seoTitle', 'text', { maxLength: 180 }],
  ['Descrição SEO padrão', 'seoDescription', 'textarea', { maxLength: 320, wide: true }],
  ['Palavras-chave SEO', 'seoKeywords', 'text', { maxLength: 500, wide: true }],
  ['Verificação do Google Search Console', 'googleSearchConsoleVerification', 'text', { maxLength: 200, wide: true }],
  ['Imagem padrão para compartilhamento (URL ou upload)', 'ogImageUrl', 'text', { maxLength: 2000, wide: true }],
  ['Cor principal', 'primaryColor', 'color', {}],
  ['Cor secundária', 'secondaryColor', 'color', {}],
];

const homepageSectionItems = [
  ['hero', 'Banner principal'],
  ['approach', 'Abordagem'],
  ['agenda', 'Próximos encontros'],
  ['about', 'Sobre'],
  ['content', 'Blog e galeria'],
  ['testimonials', 'Depoimentos'],
  ['faq', 'Perguntas frequentes'],
  ['instructors', 'Instrutores'],
  ['contact', 'Contato'],
];
const menuItemDefaults = [
  ['home', 'Início'],
  ['approach', 'A abordagem'],
  ['courses', 'Cursos'],
  ['events', 'Eventos'],
  ['about', 'Sobre'],
  ['blog', 'Blog'],
  ['contact', 'Contato'],
];

function addOrderedSettings(form, title, definitions, savedItems, editableLabels = false) {
  const fieldset = node('fieldset', 'ordered-settings wide');
  fieldset.append(node('legend', '', title));
  const saved = new Map((Array.isArray(savedItems) ? savedItems : []).map((item) => [item.key, item]));
  const controls = definitions.map(([key, defaultLabel], index) => {
    const current = saved.get(key);
    const row = node('div', 'ordered-setting-row');
    const activeLabel = node('label', 'ordered-setting-active');
    const active = node('input');
    active.type = 'checkbox';
    active.checked = current?.active ?? true;
    activeLabel.append(active, document.createTextNode('Ativo'));
    let label = defaultLabel;
    if (editableLabels) {
      const labelField = node('label', 'ordered-setting-label');
      labelField.append(document.createTextNode('Texto'));
      const input = node('input');
      input.type = 'text';
      input.value = current?.label || defaultLabel;
      input.maxLength = 40;
      input.required = true;
      labelField.append(input);
      row.append(labelField);
      label = input;
    } else {
      row.append(node('strong', '', defaultLabel));
    }
    const orderLabel = node('label', 'ordered-setting-order');
    orderLabel.append(document.createTextNode('Ordem'));
    const order = node('input');
    order.type = 'number';
    order.min = '1';
    order.max = String(definitions.length);
    order.step = '1';
    order.required = true;
    order.value = String(current?.order ?? index + 1);
    orderLabel.append(order);
    row.append(activeLabel, orderLabel);
    fieldset.append(row);
    return { key, active, order, label };
  });
  form.append(fieldset);
  return () => controls.map(({ key, active, order, label }) => ({
    key,
    ...(editableLabels ? { label: label.value.trim() } : {}),
    active: active.checked,
    order: Number(order.value),
  })).sort((left, right) => left.order - right.order);
}

async function loadSettings() {
  try {
    const result = await api('/admin/settings');
    const form = node('form', 'editor-form settings-form');
    const controls = new Map();
    for (const [label, name, type, options] of settingDefinitions) {
      controls.set(name, addField(form, label, name, type, options));
    }
    addImageUpload(form, controls.get('ogImageUrl'));
    for (const [name, control] of controls) {
      if (control.type === 'checkbox') control.checked = Boolean(result.settings[name]);
      else control.value = result.settings[name] ?? '';
    }
    controls.get('smtpPassword').placeholder = result.settings.smtpPasswordConfigured
      ? 'Já existe uma senha salva; deixe vazio para preservá-la.'
      : 'Informe a senha da conta SMTP.';
    controls.get('smtpSecure').checked = Boolean(result.settings.smtpSecure);
    addImageUpload(form, controls.get('bannerImageUrl'));
    const readSections = addOrderedSettings(form, 'Seções da página inicial (desative para ocultar)', homepageSectionItems, result.settings.homepageSections);
    const readMenu = addOrderedSettings(form, 'Itens do menu (ative, renomeie e defina a ordem)', menuItemDefaults, result.settings.menuItems, true);

    const actions = node('div', 'editor-actions');
    const save = node('button', 'admin-button button-primary', 'Salvar configurações');
    save.type = 'submit';
    actions.append(save);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const settings = Object.fromEntries(new FormData(form));
      settings.smtpEnabled = controls.get('smtpEnabled').checked;
      settings.smtpSecure = controls.get('smtpSecure').checked;
      settings.homepageSections = readSections();
      settings.menuItems = readMenu();
      save.disabled = true;
      try {
        await api('/admin/settings', { method: 'PUT', body: JSON.stringify(settings) });
        setNotice('Configurações salvas e publicadas.');
      } catch (error) {
        setNotice(error.message, true);
      } finally {
        save.disabled = false;
      }
    });
    adminView.replaceChildren(
      setHeading('Configurações gerais', 'Identidade, contato, notificações e redes sociais do site.'),
      node('p', 'settings-help wide', 'Configure aqui o servidor, porta, usuário, remetente e senha SMTP. A senha é armazenada criptografada usando o segredo JWT do servidor e nunca é exibida novamente. Deixe o campo de senha vazio para manter a senha atual. Modelos de e-mail aceitam {{name}}, {{email}}, {{phone}}, {{activity}}, {{type}}, {{date}} e {{siteName}}.'),
      form,
    );
  } catch (error) {
    adminView.replaceChildren(setHeading('Configurações gerais', 'Acesso restrito a administradores.'), node('p', 'empty-state', error.message));
  }
}

async function loadUsers() {
  try {
    const result = await api('/admin/users');
    const editor = node('section', 'editor-section');
    editor.append(node('div', 'editor-heading', 'Novo usuário administrativo'), userForm());
    const create = newButton('Novo usuário', 'secondary-button is-primary', () => {
      editor.hidden = false;
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    adminView.replaceChildren(setHeading('Usuários', 'Controle quem pode acessar o painel e o que pode alterar.', create));
    if (result.users.length === 0) adminView.append(node('p', 'empty-state', 'Nenhum usuário administrativo encontrado.'));
    else adminView.append(table(['Nome', 'Perfil', 'Último acesso', 'Estado'], result.users.map(userRow)));
    editor.hidden = true;
    adminView.append(editor);
  } catch (error) {
    adminView.replaceChildren(setHeading('Usuários', 'Acesso restrito a administradores.'), node('p', 'empty-state', error.message));
  }
}

const contentDefinitions = {
  blog: {
    path: 'blog',
    listKey: 'posts',
    singular: 'artigo',
    heading: 'Blog',
    subtitle: 'Publique textos, reflexões e novidades do espaço.',
    tableHeaders: ['Título', 'Status', 'Publicação', 'Ações'],
    fields: [
      ['Título', 'title', 'text', { required: true, minLength: 3, maxLength: 180 }],
      ['Endereço amigável', 'slug', 'text', { required: true, maxLength: 200 }],
      ['Resumo', 'excerpt', 'textarea', { required: true, minLength: 3, maxLength: 300, rows: 3 }],
      ['Conteúdo', 'content', 'textarea', { required: true, minLength: 10, maxLength: 25000, wide: true, rows: 7 }],
      ['Imagem (URL ou arquivo enviado)', 'imageUrl', 'text', { maxLength: 2000, wide: true }],
      ['Publicação', 'publishedAt', 'datetime-local', {}],
      ['Ativo', 'active', 'select', { required: true, choices: [['true', 'Ativo'], ['false', 'Inativo']] }],
    ],
    toBody: (raw) => ({
      title: raw.title,
      slug: raw.slug,
      excerpt: raw.excerpt,
      content: raw.content,
      imageUrl: raw.imageUrl || null,
      publishedAt: raw.publishedAt ? new Date(raw.publishedAt).toISOString() : null,
      active: raw.active === 'true',
    }),
    row: (item, editor) => {
      const row = node('tr');
      const title = node('td');
      title.append(node('strong', '', item.title), node('small', '', item.slug));
      const status = node('td');
      status.append(statusPill(item.active ? 'published' : 'cancelled'));
      const published = node('td', '', dateLabel(item.published_at || item.created_at));
      const actions = node('td');
      const group = node('div', 'table-actions');
      group.append(newButton('Editar', 'row-button', () => openContentEditor('blog', item, editor)));
      group.append(newButton(item.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
        try {
          await api(`/admin/blog/${item.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
          await loadContent('blog');
          setNotice(item.active ? 'Artigo desativado.' : 'Artigo ativado.');
        } catch (error) {
          setNotice(error.message, true);
        }
      }));
      actions.append(group);
      row.append(title, status, published, actions);
      return row;
    },
    values: (item, controlMap) => {
      const entries = ['title', 'slug', 'excerpt', 'content', 'imageUrl', 'publishedAt', 'active'];
      for (const key of entries) {
        const control = controlMap.get(key);
        if (!control) continue;
        const value = key === 'imageUrl' ? (item.image_url || '') : key === 'publishedAt' ? dateTimeLocal(item.published_at) : key === 'active' ? String(Boolean(item.active)) : item[key] ?? '';
        control.value = value;
      }
    },
  },
  testimonials: {
    path: 'testimonials',
    listKey: 'testimonials',
    singular: 'depoimento',
    heading: 'Depoimentos',
    subtitle: 'Mostre experiências reais e reforçe a confiança do público.',
    tableHeaders: ['Pessoa', 'Status', 'Ações'],
    fields: [
      ['Nome', 'name', 'text', { required: true, minLength: 2, maxLength: 120 }],
      ['Cargo', 'role', 'text', { maxLength: 120 }],
      ['Depoimento', 'quote', 'textarea', { required: true, minLength: 15, maxLength: 1000, wide: true, rows: 5 }],
      ['Avatar (URL ou arquivo enviado)', 'avatarUrl', 'text', { maxLength: 2000 }],
      ['Ativo', 'active', 'select', { required: true, choices: [['true', 'Ativo'], ['false', 'Inativo']] }],
    ],
    toBody: (raw) => ({
      name: raw.name,
      role: raw.role || '',
      quote: raw.quote,
      avatarUrl: raw.avatarUrl || null,
      active: raw.active === 'true',
    }),
    row: (item, editor) => {
      const row = node('tr');
      const person = node('td');
      person.append(node('strong', '', item.name), node('small', '', item.role || 'Sem cargo'));
      const status = node('td');
      status.append(statusPill(item.active ? 'published' : 'cancelled'));
      const actions = node('td');
      const group = node('div', 'table-actions');
      group.append(newButton('Editar', 'row-button', () => openContentEditor('testimonials', item, editor)));
      group.append(newButton(item.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
        try {
          await api(`/admin/testimonials/${item.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
          await loadContent('testimonials');
          setNotice(item.active ? 'Depoimento desativado.' : 'Depoimento ativado.');
        } catch (error) {
          setNotice(error.message, true);
        }
      }));
      actions.append(group);
      row.append(person, status, actions);
      return row;
    },
    values: (item, controlMap) => {
      for (const [key, control] of controlMap) {
        const value = key === 'avatarUrl' ? (item.avatar_url || '') : key === 'active' ? String(Boolean(item.active)) : item[key] ?? '';
        control.value = value;
      }
    },
  },
  faqs: {
    path: 'faqs',
    listKey: 'faqs',
    singular: 'pergunta frequente',
    heading: 'FAQ',
    subtitle: 'Organize dúvidas comuns e ajude visitantes a entender melhor o processo.',
    tableHeaders: ['Pergunta', 'Status', 'Ações'],
    fields: [
      ['Pergunta', 'question', 'text', { required: true, minLength: 5, maxLength: 200 }],
      ['Resposta', 'answer', 'textarea', { required: true, minLength: 10, maxLength: 4000, wide: true, rows: 5 }],
      ['Ativo', 'active', 'select', { required: true, choices: [['true', 'Ativo'], ['false', 'Inativo']] }],
    ],
    toBody: (raw) => ({
      question: raw.question,
      answer: raw.answer,
      active: raw.active === 'true',
    }),
    row: (item, editor) => {
      const row = node('tr');
      const question = node('td');
      question.append(node('strong', '', item.question));
      const status = node('td');
      status.append(statusPill(item.active ? 'published' : 'cancelled'));
      const actions = node('td');
      const group = node('div', 'table-actions');
      group.append(newButton('Editar', 'row-button', () => openContentEditor('faqs', item, editor)));
      group.append(newButton(item.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
        try {
          await api(`/admin/faqs/${item.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
          await loadContent('faqs');
          setNotice(item.active ? 'Pergunta desativada.' : 'Pergunta ativada.');
        } catch (error) {
          setNotice(error.message, true);
        }
      }));
      actions.append(group);
      row.append(question, status, actions);
      return row;
    },
    values: (item, controlMap) => {
      for (const [key, control] of controlMap) {
        const value = key === 'active' ? String(Boolean(item.active)) : item[key] ?? '';
        control.value = value;
      }
    },
  },
  gallery: {
    path: 'gallery',
    listKey: 'gallery',
    singular: 'item da galeria',
    heading: 'Galeria',
    subtitle: 'Organize imagens e momentos do processo de acolhimento.',
    tableHeaders: ['Galeria / foto', 'Status', 'Ações'],
    fields: [
      ['Nome da galeria', 'galleryName', 'text', { required: true, minLength: 2, maxLength: 120 }],
      ['Título', 'title', 'text', { required: true, minLength: 2, maxLength: 180 }],
      ['Descrição', 'description', 'textarea', { maxLength: 300, rows: 3 }],
      ['Imagem (URL ou arquivo enviado)', 'imageUrl', 'text', { required: true, maxLength: 2000, wide: true }],
      ['Ativo', 'active', 'select', { required: true, choices: [['true', 'Ativo'], ['false', 'Inativo']] }],
    ],
    toBody: (raw) => ({
      galleryName: raw.galleryName,
      title: raw.title,
      description: raw.description || '',
      imageUrl: raw.imageUrl,
      active: raw.active === 'true',
    }),
    row: (item, editor) => {
      const row = node('tr');
      const title = node('td');
      title.append(
        node('strong', '', item.gallery_name || 'Galeria geral'),
        node('small', '', `${item.title}${item.description ? ` · ${item.description}` : ''}`),
      );
      const status = node('td');
      status.append(statusPill(item.active ? 'published' : 'cancelled'));
      const actions = node('td');
      const group = node('div', 'table-actions');
      group.append(newButton('Editar', 'row-button', () => openContentEditor('gallery', item, editor)));
      group.append(newButton(item.active ? 'Desativar' : 'Ativar', 'row-button', async () => {
        try {
          await api(`/admin/gallery/${item.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
          await loadContent('gallery');
          setNotice(item.active ? 'Imagem desativada.' : 'Imagem ativada.');
        } catch (error) {
          setNotice(error.message, true);
        }
      }));
      actions.append(group);
      row.append(title, status, actions);
      return row;
    },
    values: (item, controlMap) => {
      for (const [key, control] of controlMap) {
        const value = key === 'imageUrl' ? (item.image_url || '')
          : key === 'galleryName' ? (item.gallery_name || 'Galeria geral')
            : key === 'active' ? String(Boolean(item.active)) : item[key] ?? '';
        control.value = value;
      }
    },
  },
};

function contentForm(resource, item) {
  const config = contentDefinitions[resource];
  const form = node('form', 'editor-form');
  const controls = new Map();
  for (const [label, name, type, options] of config.fields) controls.set(name, addField(form, label, name, type, options));
  const imageField = { blog: 'imageUrl', testimonials: 'avatarUrl', gallery: 'imageUrl' }[resource];
  if (imageField) addImageUpload(form, controls.get(imageField));
  if (item) config.values(item, controls);

  const actions = node('div', 'editor-actions');
  const save = node('button', 'admin-button button-primary', item ? 'Salvar alterações' : `Criar ${config.singular}`);
  save.type = 'submit';
  actions.append(save, newButton('Cancelar', 'secondary-button', () => loadContent(resource)));
  form.append(actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(form));
    const body = config.toBody(raw);
    save.disabled = true;
    setNotice('Salvando conteúdo...');
    try {
      await api(`/admin/${resource}${item ? `/${item.id}` : ''}`, {
        method: item ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      await loadContent(resource);
      setNotice(item ? 'Conteúdo atualizado.' : 'Conteúdo criado.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });

  return form;
}

function openContentEditor(resource, item, oldEditor) {
  const editor = node('section', 'editor-section');
  editor.append(node('div', 'editor-heading', `Editar: ${item.title || item.name || item.question || 'Item'}`), contentForm(resource, item));
  oldEditor.replaceWith(editor);
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadContent(resource) {
  const config = contentDefinitions[resource];
  try {
    const result = await api(`/admin/${resource}`);
    const records = result[config.listKey] || [];
    const editor = node('section', 'editor-section');
    editor.append(node('div', 'editor-heading', `Novo ${config.singular}`), contentForm(resource));
    const create = newButton(`Novo ${config.singular}`, 'secondary-button is-primary', () => {
      editor.hidden = false;
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    adminView.replaceChildren(setHeading(config.heading, config.subtitle, create));
    if (records.length === 0) adminView.append(node('p', 'empty-state', `Nenhum ${config.singular} cadastrado ainda.`));
    else adminView.append(table(config.tableHeaders, records.map((item) => config.row(item, editor))));
    editor.hidden = true;
    adminView.append(editor);
  } catch (error) {
    adminView.replaceChildren(setHeading(config.heading, 'Acesso restrito por permissões.'), node('p', 'empty-state', error.message));
  }
}

function userForm() {
  const form = node('form', 'editor-form');
  addField(form, 'Nome', 'name', 'text', { required: true, minLength: 2, maxLength: 120 });
  addField(form, 'E-mail', 'email', 'email', { required: true, maxLength: 254 });
  addField(form, 'Senha temporária (mínimo de 12 caracteres)', 'password', 'password', { required: true, minLength: 12, maxLength: 128 });
  addField(form, 'Perfil', 'role', 'select', { required: true, choices: [['editor', 'Editor'], ['attendant', 'Atendente'], ['admin', 'Administrador']] });
  const actions = node('div', 'editor-actions');
  const save = node('button', 'admin-button button-primary', 'Criar usuário');
  save.type = 'submit';
  actions.append(save, newButton('Cancelar', 'secondary-button', () => loadUsers()));
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    try {
      await api('/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      await loadUsers();
      setNotice('Usuário criado.');
    } catch (error) {
      save.disabled = false;
      setNotice(error.message, true);
    }
  });
  return form;
}

function userRow(user) {
  const row = node('tr');
  const name = node('td');
  name.append(node('strong', '', user.name), node('small', '', user.email));
  const roleCell = node('td');
  const role = node('select', 'status-select');
  role.setAttribute('aria-label', `Perfil de ${user.name}`);
  for (const value of ['admin', 'editor', 'attendant']) {
    const option = node('option', '', { admin: 'Administrador', editor: 'Editor', attendant: 'Atendente' }[value]);
    option.value = value;
    option.selected = user.roles.includes(value);
    role.append(option);
  }
  role.addEventListener('change', async () => {
    role.disabled = true;
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: role.value }) });
      setNotice('Perfil atualizado.');
    } catch (error) {
      setNotice(error.message, true);
      await loadUsers();
    }
  });
  roleCell.append(role);
  const lastLogin = node('td', '', dateLabel(user.last_login_at));
  const activeCell = node('td');
  const active = node('select', 'status-select');
  active.setAttribute('aria-label', `Estado de ${user.name}`);
  for (const [value, label] of [['true', 'Ativo'], ['false', 'Inativo']]) {
    const option = node('option', '', label);
    option.value = value;
    option.selected = String(user.active) === value;
    active.append(option);
  }
  active.addEventListener('change', async () => {
    active.disabled = true;
    try {
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active: active.value === 'true' }) });
      setNotice('Acesso atualizado.');
      await loadUsers();
    } catch (error) {
      setNotice(error.message, true);
      await loadUsers();
    }
  });
  activeCell.append(active);
  row.append(name, roleCell, lastLogin, activeCell);
  return row;
}

async function loadRecords(resource) {
  const labels = resource === 'enrollments'
    ? ['Inscrições', 'Acompanhe os pedidos e atualize o atendimento.']
    : ['Contatos', 'Mensagens recebidas pelo site.'];
  try {
    const result = await api(`/admin/${resource}`);
    const records = result[resource];
    const filters = filterControls(resource, records);
    adminView.replaceChildren(setHeading(labels[0], labels[1]), filters);
    if (records.length === 0) {
      adminView.append(node('p', 'empty-state', resource === 'enrollments' ? 'Nenhuma inscrição recebida ainda.' : 'Nenhuma mensagem recebida ainda.'));
      return;
    }
    const rows = records.map((record) => {
      const row = node('tr');
      const person = node('td');
      person.append(node('strong', '', record.name), node('small', '', `${record.email} · ${record.phone || 'Sem telefone'}`));
      const detail = node('td');
      if (resource === 'enrollments') {
        detail.append(node('strong', '', record.activity_title || 'Atividade indisponível'), node('small', '', record.activity_type === 'course' ? 'Curso' : 'Evento'));
      } else {
        detail.append(node('strong', '', record.subject));
        const disclosure = node('details', 'message-details');
        disclosure.append(node('summary', '', 'Ler mensagem'), node('p', '', record.message));
        detail.append(disclosure);
      }
      const date = node('td', '', dateLabel(record.created_at));
      const statusCell = node('td');
      const select = node('select', 'status-select');
      select.setAttribute('aria-label', `Status de ${record.name}`);
      const options = resource === 'enrollments' ? statusOptions.enrollments : statusOptions.contacts;
      for (const value of options) {
        const option = node('option', '', statusLabels[value]);
        option.value = value;
        option.selected = value === record.status;
        select.append(option);
      }
      updateStatusSelect(resource, record.id, select);
      statusCell.append(select);
      row.append(person, detail, date, statusCell);
      row.dataset.status = record.status;
      row.dataset.search = `${record.name} ${record.email} ${record.phone || ''} ${record.activity_title || record.subject || ''}`.toLowerCase();
      row.dataset.type = record.activity_type || '';
      row.dataset.activity = record.activity_title || '';
      row.dataset.date = localDateKey(record.created_at);
      return row;
    });
    adminView.append(table(['Pessoa', resource === 'enrollments' ? 'Curso/evento' : 'Assunto e mensagem', 'Recebido', 'Status'], rows));
  } catch (error) {
    adminView.replaceChildren(setHeading(labels[0], labels[1]), node('p', 'empty-state', error.message));
  }
}

async function loadView(view) {
  for (const link of document.querySelectorAll('[data-view]')) {
    link.classList.toggle('is-active', link.dataset.view === view);
  }
  setNotice('');
  if (view === 'dashboard') {
    try {
      await loadDashboard();
    } catch (error) {
      adminView.replaceChildren(setHeading('Visão geral', 'Resumo atualizado do site e do atendimento.'), node('p', 'empty-state', error.message));
    }
  } else if (view === 'courses' || view === 'events') {
    await loadActivities(view);
  } else if (view === 'instructors') {
    await loadInstructors();
  } else if (view === 'course-categories') {
    await loadCourseCategoriesView();
  } else if (view === 'course-modules') {
    await loadCourseModulesView();
  } else if (['blog', 'testimonials', 'faqs', 'gallery'].includes(view)) {
    await loadContent(view);
  } else if (view === 'settings') {
    await loadSettings();
  } else if (view === 'users') {
    await loadUsers();
  } else {
    await loadRecords(view);
  }
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => loadView(button.dataset.view));
});

document.querySelector('[data-login-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const feedback = document.querySelector('[data-login-feedback]');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  showFeedback(feedback, 'Verificando acesso...');
  try {
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    sessionStorage.setItem(tokenKey, result.accessToken);
    await showAdminShell(result.user);
    form.reset();
  } catch (error) {
    showFeedback(feedback, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-setup-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const feedback = document.querySelector('[data-setup-feedback]');
  const button = form.querySelector('button[type="submit"]');
  const fields = Object.fromEntries(new FormData(form));
  const setupToken = fields.setupToken;
  delete fields.setupToken;
  button.disabled = true;
  showFeedback(feedback, 'Criando administrador...');
  try {
    const result = await api('/auth/setup', {
      method: 'POST',
      headers: { 'x-setup-token': setupToken },
      body: JSON.stringify(fields),
    });
    sessionStorage.setItem(tokenKey, result.accessToken);
    form.reset();
    await showAdminShell(result.user);
  } catch (error) {
    showFeedback(feedback, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-show-setup]').addEventListener('click', () => setAccessView('setup'));
document.querySelector('[data-show-login]').addEventListener('click', () => setAccessView('login'));
document.querySelector('[data-logout]').addEventListener('click', () => {
  sessionStorage.removeItem(tokenKey);
  showAccessScreen();
});

async function restoreSession() {
  if (!sessionStorage.getItem(tokenKey)) return;
  try {
    const result = await api('/auth/me');
    await showAdminShell(result.user);
  } catch {
    sessionStorage.removeItem(tokenKey);
    showAccessScreen();
  }
}

restoreSession();