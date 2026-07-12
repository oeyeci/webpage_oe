import type { ResourceConfig } from '../../components/admin/ResourceManager';

/**
 * Field definitions for the schema-driven admin screens.
 *
 * These mirror the Zod schemas in `lib/validation/schemas.ts` — the server is
 * still the authority, and a mismatch here shows up as a field-level error
 * rather than as bad data.
 */

export const experienceConfig: ResourceConfig = {
  resource: 'experiences',
  singular: 'Position',
  titleKey: 'title',
  subtitleKey: 'organization',
  badgeKeys: ['type', 'isCurrent'],
  metaKey: 'startDate',
  fields: [
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      defaultValue: 'academic',
      options: [
        { value: 'academic', label: 'Academic' },
        { value: 'administrative', label: 'Administrative' },
        { value: 'industry', label: 'Industry' },
        { value: 'visiting', label: 'Visiting' },
        { value: 'editorial', label: 'Editorial' },
        { value: 'teaching', label: 'Teaching' },
      ],
    },
    { key: 'title', label: 'Job title', type: 'text', required: true },
    { key: 'organization', label: 'Organization', type: 'text', required: true },
    { key: 'department', label: 'Department', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    {
      key: 'startDate',
      label: 'Start date',
      type: 'date',
      required: true,
      hint: 'YYYY-MM-DD (day precision is optional).',
    },
    { key: 'endDate', label: 'End date', type: 'date', hint: 'Leave empty if current.' },
    { key: 'isCurrent', label: 'Current position', type: 'toggle' },
    { key: 'url', label: 'Link', type: 'url' },
    {
      key: 'descriptionMd',
      label: 'Description',
      type: 'markdown',
      wide: true,
      hint: 'Markdown. Rendered to HTML on save.',
    },
    { key: 'isPublished', label: 'Visible on the site', type: 'toggle', defaultValue: true },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const projectConfig: ResourceConfig = {
  resource: 'projects',
  singular: 'Project',
  titleKey: 'title',
  subtitleKey: 'funder',
  badgeKeys: ['role', 'status'],
  metaKey: 'startDate',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, wide: true },
    { key: 'funder', label: 'Funder', type: 'text', placeholder: 'TÜBİTAK, BAP, EU…' },
    { key: 'grantNumber', label: 'Grant number', type: 'text' },
    {
      key: 'role',
      label: 'Role',
      type: 'select',
      defaultValue: 'researcher',
      options: [
        { value: 'pi', label: 'Principal Investigator' },
        { value: 'co-pi', label: 'Co-Principal Investigator' },
        { value: 'researcher', label: 'Researcher' },
        { value: 'advisor', label: 'Advisor' },
        { value: 'scholar', label: 'Scholar' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: 'completed',
      options: [
        { value: 'ongoing', label: 'Ongoing' },
        { value: 'completed', label: 'Completed' },
        { value: 'planned', label: 'Planned' },
      ],
    },
    { key: 'startDate', label: 'Start date', type: 'date' },
    { key: 'endDate', label: 'End date', type: 'date' },
    {
      key: 'scope',
      label: 'Scope',
      type: 'select',
      defaultValue: 'national',
      options: [
        { value: 'national', label: 'National' },
        { value: 'international', label: 'International' },
      ],
    },
    { key: 'url', label: 'Link', type: 'url' },
    { key: 'team', label: 'Team', type: 'textarea', wide: true, hint: 'Collaborators, as listed on the grant.' },
    { key: 'descriptionMd', label: 'Description', type: 'markdown', wide: true },
    { key: 'isPublished', label: 'Visible on the site', type: 'toggle', defaultValue: true },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const thesisConfig: ResourceConfig = {
  resource: 'theses',
  singular: 'Thesis',
  titleKey: 'studentName',
  subtitleKey: 'title',
  badgeKeys: ['degree', 'status'],
  metaKey: 'year',
  fields: [
    { key: 'studentName', label: 'Student', type: 'text', required: true },
    {
      key: 'degree',
      label: 'Degree',
      type: 'select',
      required: true,
      defaultValue: 'msc',
      options: [
        { value: 'msc', label: "Master's" },
        { value: 'phd', label: 'Doctoral' },
      ],
    },
    { key: 'title', label: 'Thesis title', type: 'textarea', required: true, wide: true },
    { key: 'institution', label: 'Institution', type: 'text', wide: true },
    { key: 'year', label: 'Year', type: 'year' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: 'completed',
      options: [
        { value: 'completed', label: 'Completed' },
        { value: 'ongoing', label: 'Ongoing' },
      ],
    },
    { key: 'url', label: 'Link', type: 'url' },
    { key: 'isPublished', label: 'Visible on the site', type: 'toggle', defaultValue: true },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const skillConfig = (
  categories: Array<{ id: number; name: string }>,
): ResourceConfig => ({
  resource: 'skills',
  singular: 'Skill',
  titleKey: 'name',
  subtitleKey: 'description',
  badgeKeys: ['levelLabel', 'isFeatured'],
  metaKey: 'level',
  fields: [
    {
      key: 'categoryId',
      label: 'Category',
      type: 'select',
      required: true,
      defaultValue: categories[0]?.id ?? '',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    { key: 'name', label: 'Name', type: 'text', required: true },
    {
      key: 'level',
      label: 'Level (0–100)',
      type: 'number',
      defaultValue: 0,
      hint: 'Only used by categories displayed as bars.',
    },
    { key: 'levelLabel', label: 'Level label', type: 'text', placeholder: 'Expert, Advanced…' },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'issuedBy', label: 'Issued by', type: 'text', hint: 'Certificates only.' },
    { key: 'issuedYear', label: 'Issued year', type: 'year' },
    { key: 'credentialId', label: 'Credential ID', type: 'text' },
    { key: 'url', label: 'Link', type: 'url' },
    { key: 'isFeatured', label: 'Show on the home page', type: 'toggle' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
});

export const skillCategoryConfig: ResourceConfig = {
  resource: 'skill-categories',
  singular: 'Skill category',
  titleKey: 'name',
  subtitleKey: 'description',
  badgeKeys: ['displayMode'],
  metaKey: 'sortOrder',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    {
      key: 'displayMode',
      label: 'Display as',
      type: 'select',
      defaultValue: 'bar',
      options: [
        { value: 'bar', label: 'Proficiency bars' },
        { value: 'chip', label: 'Chips' },
        { value: 'card', label: 'Cards' },
        { value: 'certificate', label: 'Certificates' },
      ],
      hint: 'How this group renders on the public Skills page.',
    },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const educationConfig: ResourceConfig = {
  resource: 'education',
  singular: 'Degree',
  titleKey: 'degree',
  subtitleKey: 'institution',
  metaKey: 'endYear',
  fields: [
    { key: 'degree', label: 'Degree', type: 'text', required: true, placeholder: 'Ph.D.' },
    { key: 'field', label: 'Field', type: 'text', placeholder: 'Physics' },
    { key: 'institution', label: 'Institution', type: 'text', required: true },
    { key: 'department', label: 'Department', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'startYear', label: 'Start year', type: 'year' },
    { key: 'endYear', label: 'End year', type: 'year' },
    { key: 'completedOn', label: 'Completed on', type: 'text', placeholder: '22 August 2012' },
    { key: 'thesisTitle', label: 'Thesis title', type: 'textarea', wide: true },
    { key: 'advisor', label: 'Advisor', type: 'text' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const awardConfig: ResourceConfig = {
  resource: 'awards',
  singular: 'Award',
  titleKey: 'title',
  subtitleKey: 'issuer',
  metaKey: 'year',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, wide: true },
    { key: 'issuer', label: 'Issuer', type: 'text' },
    { key: 'year', label: 'Year', type: 'year' },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'url', label: 'Link', type: 'url' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const membershipConfig: ResourceConfig = {
  resource: 'memberships',
  singular: 'Membership',
  titleKey: 'organization',
  subtitleKey: 'role',
  metaKey: 'startYear',
  fields: [
    { key: 'organization', label: 'Organization', type: 'text', required: true, wide: true },
    { key: 'role', label: 'Role', type: 'text', placeholder: 'Associate Editor' },
    { key: 'startYear', label: 'Start year', type: 'year' },
    { key: 'endYear', label: 'End year', type: 'year' },
    { key: 'url', label: 'Link', type: 'url' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const researchInterestConfig: ResourceConfig = {
  resource: 'research-interests',
  singular: 'Research interest',
  titleKey: 'title',
  subtitleKey: 'description',
  badgeKeys: ['isFeatured'],
  metaKey: 'sortOrder',
  fields: [
    { key: 'title', label: 'Title', type: 'text', required: true, wide: true },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'isFeatured', label: 'Show on the home page', type: 'toggle' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const blogCategoryConfig: ResourceConfig = {
  resource: 'blog-categories',
  singular: 'Category',
  titleKey: 'name',
  subtitleKey: 'description',
  metaKey: 'sortOrder',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'color', label: 'Colour', type: 'text', defaultValue: '#5b6bf0', placeholder: '#5b6bf0' },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};

export const activityCategoryConfig: ResourceConfig = {
  resource: 'activity-categories',
  singular: 'Category',
  titleKey: 'name',
  metaKey: 'sortOrder',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'color', label: 'Colour', type: 'text', defaultValue: '#0ea5a4', placeholder: '#0ea5a4' },
    { key: 'sortOrder', label: 'Sort order', type: 'number', defaultValue: 0 },
  ],
};
