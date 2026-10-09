const templateValues = ({ name, email, phone, activity, type, date, siteName }) => ({
  name,
  email,
  phone,
  activity,
  type,
  date,
  siteName,
});

function renderTemplate(template, values) {
  return template.replace(/\{\{(name|email|phone|activity|type|date|siteName)\}\}/g, (_, key) => values[key]);
}

async function enqueueEnrollmentNotifications(client, enrollment, activity, siteSettings) {
  const siteName = siteSettings.site_name || 'Constelacao Familiar';
  const values = templateValues({
    ...enrollment,
    activity: activity.title,
    type: enrollment.courseId ? 'Curso' : 'Evento',
    date: activity.starts_at
      ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
        .format(new Date(activity.starts_at))
      : 'Data a confirmar',
    siteName,
  });

  const messages = [
    {
      recipientType: 'admin',
      recipientEmail: siteSettings.notification_admin_email || siteSettings.contact_email || null,
      subject: renderTemplate(siteSettings.enrollment_admin_subject || 'Nova inscrição recebida: {{activity}}', values),
      body: renderTemplate(
        siteSettings.enrollment_admin_message
          || 'Nova inscrição recebida para {{activity}} ({{type}}).\n\nNome: {{name}}\nE-mail: {{email}}\nTelefone: {{phone}}\nData: {{date}}',
        values,
      ),
    },
    {
      recipientType: 'customer',
      recipientEmail: enrollment.email,
      subject: renderTemplate(siteSettings.enrollment_customer_subject || 'Recebemos sua inscrição: {{activity}}', values),
      body: renderTemplate(
        siteSettings.enrollment_customer_message
          || 'Ola, {{name}}!\n\nRecebemos sua inscrição para {{activity}}. Em breve entraremos em contato.\n\n{{siteName}}',
        values,
      ),
    },
  ];

  for (const message of messages) {
    await client.query(
      `INSERT INTO notification_outbox (recipient_type, recipient_email, subject, body)
       VALUES ($1, $2, $3, $4)`,
      [message.recipientType, message.recipientEmail, message.subject, message.body],
    );
  }
}

module.exports = { enqueueEnrollmentNotifications };
