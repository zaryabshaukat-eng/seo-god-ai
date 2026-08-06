import { className, h } from '../vdom.js';
import type { BadgeTone, Toast, VChild, VNode } from '../types.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type { BadgeTone } from '../types.js';

// ─── Buttons ──────────────────────────────────────────────────────────────────

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  ariaLabel?: string;
  dataAction?: string;
  id?: string;
}

export function buttonEl(props: ButtonProps): VNode {
  return h(
    'button',
    {
      id: props.id,
      class: className('btn', `btn--${props.variant ?? 'primary'}`),
      type: props.type ?? 'button',
      disabled: props.disabled,
      'aria-label': props.ariaLabel,
      'aria-disabled': props.disabled,
      'data-action': props.dataAction,
    },
    props.label,
  );
}

// ─── Form fields ──────────────────────────────────────────────────────────────

export interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value?: string;
  name?: string;
  required?: boolean;
  invalid?: boolean;
  errorText?: string;
  placeholder?: string;
  autocomplete?: string;
  describedBy?: string;
}

export function fieldError(id: string, errorText?: string): VNode {
  if (!errorText) {
    return h('div', { 'data-field-error': false });
  }
  return h('p', { id: `${id}-error`, class: 'field__error', role: 'alert' }, errorText);
}

export function inputEl(props: FieldProps): VNode {
  const errorId = props.invalid && props.errorText ? `${props.id}-error` : undefined;
  const label = h('label', { class: 'field__label', for: props.id }, props.label);
  const input = h('input', {
    id: props.id,
    class: className('field__control', props.invalid && 'field__control--invalid'),
    type: props.type ?? 'text',
    value: props.value,
    name: props.name,
    required: props.required,
    placeholder: props.placeholder,
    autocomplete: props.autocomplete,
    'aria-invalid': props.invalid,
    'aria-describedby': errorId,
  });
  return h('div', { class: 'field' }, label, input, fieldError(props.id, errorId ? props.errorText : undefined));
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends FieldProps {
  options: SelectOption[];
}

export function selectEl(props: SelectProps): VNode {
  const errorId = props.invalid && props.errorText ? `${props.id}-error` : undefined;
  const label = h('label', { class: 'field__label', for: props.id }, props.label);
  const options = props.options.map((option) =>
    h('option', { value: option.value, selected: option.value === props.value }, option.label),
  );
  const select = h(
    'select',
    {
      id: props.id,
      class: className('field__control', props.invalid && 'field__control--invalid'),
      name: props.name,
      required: props.required,
      'aria-invalid': props.invalid,
      'aria-describedby': errorId,
    },
    ...options,
  );
  return h('div', { class: 'field' }, label, select, fieldError(props.id, errorId ? props.errorText : undefined));
}

export function textareaEl(props: FieldProps): VNode {
  const errorId = props.invalid && props.errorText ? `${props.id}-error` : undefined;
  const label = h('label', { class: 'field__label', for: props.id }, props.label);
  const textarea = h('textarea', {
    id: props.id,
    class: className('field__control', props.invalid && 'field__control--invalid'),
    name: props.name,
    required: props.required,
    'aria-invalid': props.invalid,
    'aria-describedby': errorId,
  }, props.value ?? '');
  return h('div', { class: 'field' }, label, textarea, fieldError(props.id, errorId ? props.errorText : undefined));
}

export interface CheckboxProps {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  description?: string;
}

export function checkboxEl(props: CheckboxProps): VNode {
  const input = h('input', {
    id: props.id,
    class: 'field__checkbox',
    type: 'checkbox',
    name: props.name,
    value: props.value,
    checked: props.checked,
    disabled: props.disabled,
  });
  const label = h('label', { class: 'field__label field__label--checkbox', for: props.id }, input, props.label);
  return h('div', { class: 'field' }, label);
}

// ─── Surfaces ─────────────────────────────────────────────────────────────────

export interface CardProps {
  title: string;
  subtitle?: string;
  children?: VChild[];
  actions?: VChild[];
}

export function cardEl(props: CardProps): VNode {
  const heading = h('h2', { class: 'card__title', id: `${slug(props.title)}-title` }, props.title);
  const subtitle = props.subtitle ? h('p', { class: 'card__subtitle' }, props.subtitle) : undefined;
  const header = h('header', { class: 'card__header' }, heading, subtitle);
  const actions = props.actions && props.actions.length > 0 ? h('div', { class: 'card__actions' }, ...props.actions) : undefined;
  return h('section', { class: 'card' }, header, h('div', { class: 'card__body' }, ...(props.children ?? [])), actions);
}

export function badgeEl(props: { label: string; tone?: BadgeTone }): VNode {
  return h('span', { class: className('badge', `badge--${props.tone ?? 'neutral'}`) }, props.label);
}

export function spinnerEl(props: { label?: string } = {}): VNode {
  return h('span', { class: 'spinner', role: 'status', 'aria-label': props.label ?? 'Loading' });
}

// ─── Table ────────────────────────────────────────────────────────────────────

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
}

export interface TableModel {
  id: string;
  caption?: string;
  columns: TableColumn[];
  rows: Array<Record<string, VChild>>;
  emptyText?: string;
  sortable?: boolean;
}

export function tableEl(model: TableModel): VNode {
  const caption = model.caption ? h('caption', { class: 'sr-only' }, model.caption) : undefined;
  const headers = model.columns.map((column) =>
    h(
      'th',
      {
        scope: 'col',
        align: column.align,
        'aria-sort': model.sortable ? 'none' : undefined,
      },
      column.label,
    ),
  );
  const head = h('thead', undefined, h('tr', { class: 'table__row' }, ...headers));

  let body: VNode;
  if (model.rows.length === 0) {
    const empty = h(
      'td',
      { colSpan: model.columns.length, class: 'table__empty' },
      model.emptyText ?? 'No rows to display.',
    );
    body = h('tbody', undefined, h('tr', undefined, empty));
  } else {
    const rows = model.rows.map((row) =>
      h(
        'tr',
        { class: 'table__row' },
        ...model.columns.map((column) => h('td', { align: column.align }, row[column.key] ?? '')),
      ),
    );
    body = h('tbody', undefined, ...rows);
  }

  return h(
    'table',
    { id: model.id, class: 'table', role: 'table', 'aria-label': model.caption },
    caption,
    head,
    body,
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export interface ModalModel {
  id: string;
  title: string;
  body: VChild[];
  footer?: VChild[];
  open?: boolean;
  closeAction?: string;
  closeLabel?: string;
}

export function modalEl(model: ModalModel): VNode {
  const titleId = `${model.id}-title`;
  const close = buttonEl({
    label: model.closeLabel ?? 'Close',
    variant: 'ghost',
    ariaLabel: model.closeLabel ?? 'Close dialog',
    dataAction: model.closeAction ?? `close:${model.id}`,
  });
  return h(
    'div',
    { class: 'modal', 'data-modal': true, hidden: model.open === false },
    h('div', { class: 'modal__backdrop', 'data-action': model.closeAction ?? `close:${model.id}` }),
    h(
      'div',
      { class: 'modal__dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('header', { class: 'modal__header' }, h('h2', { id: titleId, class: 'modal__title' }, model.title), close),
      h('div', { class: 'modal__body' }, ...model.body),
      model.footer && model.footer.length > 0 ? h('footer', { class: 'modal__footer' }, ...model.footer) : undefined,
    ),
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

export function toastEl(toast: Toast): VNode {
  const close = buttonEl({
    label: 'Dismiss',
    variant: 'ghost',
    ariaLabel: `Dismiss notification: ${toast.message}`,
    dataAction: `dismiss:${toast.id}`,
  });
  return h(
    'div',
    { class: className('toast', `toast--${toast.kind}`), role: 'status' },
    h('p', { class: 'toast__message' }, toast.message),
    close,
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

export interface FormModel {
  id: string;
  title?: string;
  description?: string;
  fields: VNode[];
  submitLabel: string;
  submitAction?: string;
  cancelLabel?: string;
  cancelAction?: string;
  errorText?: string;
}

export function formEl(model: FormModel): VNode {
  const errorId = `${model.id}-error`;
  const title = model.title ? h('h2', { class: 'form__title' }, model.title) : undefined;
  const description = model.description ? h('p', { class: 'form__description' }, model.description) : undefined;
  const error = model.errorText ? h('p', { id: errorId, class: 'form__error', role: 'alert' }, model.errorText) : undefined;
  const cancel = model.cancelLabel
    ? buttonEl({ label: model.cancelLabel, variant: 'ghost', dataAction: model.cancelAction })
    : undefined;
  const submit = buttonEl({ label: model.submitLabel, type: 'submit', dataAction: model.submitAction });
  return h(
    'form',
    { id: model.id, class: 'form', novalidate: true },
    title,
    description,
    h('div', { class: 'form__fields' }, ...model.fields),
    error,
    h('div', { class: 'form__actions' }, submit, cancel),
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
