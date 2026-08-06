import { describe, expect, it } from 'vitest';
import { h, renderToString } from '../vdom.js';
import type { BadgeTone } from '../types.js';
import {
  badgeEl,
  buttonEl,
  cardEl,
  checkboxEl,
  fieldError,
  formEl,
  inputEl,
  modalEl,
  selectEl,
  spinnerEl,
  tableEl,
  textareaEl,
  toastEl,
} from './primitives.js';
import type { Toast } from '../types.js';

describe('buttonEl', () => {
  it('renders with variant classes and attributes', () => {
    const html = renderToString(buttonEl({ label: 'Run', variant: 'danger', type: 'submit', dataAction: 'run:crawl', id: 'go' }));
    expect(html).toContain('class="btn btn--danger"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('data-action="run:crawl"');
    expect(html).toContain('id="go"');
    expect(html).toContain('>Run</button>');
  });

  it('renders a disabled button', () => {
    const html = renderToString(buttonEl({ label: 'Run', disabled: true, ariaLabel: 'run it' }));
    expect(html).toContain('aria-disabled');
    expect(html).toContain('aria-label="run it"');
  });
});

describe('fieldError', () => {
  it('renders an alert when there is an error', () => {
    const html = renderToString(fieldError('email', 'Invalid email'));
    expect(html).toContain('id="email-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Invalid email');
  });

  it('renders nothing meaningful without an error', () => {
    const html = renderToString(fieldError('email'));
    expect(html).not.toContain('role="alert"');
  });
});

describe('inputEl', () => {
  it('renders a labeled field wired to its error', () => {
    const html = renderToString(inputEl({ id: 'email', label: 'Email', invalid: true, errorText: 'Bad' }));
    expect(html).toContain('class="field__label"');
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('id="email-error"');
  });

  it('renders plain attributes when valid', () => {
    const html = renderToString(inputEl({ id: 'n', label: 'Name', required: true, autocomplete: 'name' }));
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('autocomplete="name"');
  });
});

describe('selectEl', () => {
  it('renders options with a selected value', () => {
    const html = renderToString(
      selectEl({ id: 's', label: 'Sort', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'b' }),
    );
    expect(html).toContain('value="a"');
    expect(html).toContain('value="b"');
    expect(html).toContain('>B</option>');
  });

  it('wires an invalid select to its error', () => {
    const html = renderToString(selectEl({ id: 's', label: 'Sort', options: [{ value: 'a', label: 'A' }], invalid: true, errorText: 'Bad' }));
    expect(html).toContain('aria-invalid');
    expect(html).toContain('aria-describedby="s-error"');
    expect(html).toContain('id="s-error"');
    expect(html).toContain('>Bad</p>');
  });

  it('marks invalid selects without an error text', () => {
    const html = renderToString(selectEl({ id: 's', label: 'Sort', options: [{ value: 'a', label: 'A' }], invalid: true }));
    expect(html).toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });
});

describe('textareaEl', () => {
  it('renders a textarea with its content', () => {
    const html = renderToString(textareaEl({ id: 't', label: 'Notes', value: 'hello' }));
    expect(html).toContain('<textarea');
    expect(html).toContain('hello</textarea>');
  });

  it('wires an invalid textarea to its error', () => {
    const html = renderToString(textareaEl({ id: 't', label: 'Notes', value: 'x', invalid: true, errorText: 'Bad' }));
    expect(html).toContain('aria-invalid');
    expect(html).toContain('aria-describedby="t-error"');
    expect(html).toContain('id="t-error"');
  });
});

describe('checkboxEl', () => {
  it('renders a labeled checkbox', () => {
    const html = renderToString(checkboxEl({ id: 'c', label: 'Enable', checked: true }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('>Enable</label>');
  });
});

describe('cardEl', () => {
  it('renders title, subtitle, children and actions', () => {
    const html = renderToString(
      cardEl({ title: 'Overview', subtitle: 'today', children: ['body'], actions: ['action'] }),
    );
    expect(html).toContain('id="overview-title"');
    expect(html).toContain('card__subtitle');
    expect(html).toContain('card__actions');
    expect(html).toContain('>body</div>');
  });

  it('skips optional sections', () => {
    const html = renderToString(cardEl({ title: 'Empty' }));
    expect(html).not.toContain('card__subtitle');
    expect(html).not.toContain('card__actions');
  });
});

describe('badgeEl', () => {
  it('renders a tone class', () => {
    const tones: BadgeTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];
    for (const tone of tones) {
      expect(renderToString(badgeEl({ label: 'x', tone }))).toContain(`badge--${tone}`);
    }
  });

  it('defaults to neutral without a tone', () => {
    expect(renderToString(badgeEl({ label: 'x' }))).toContain('badge--neutral');
  });
});

describe('spinnerEl', () => {
  it('renders a loading spinner with a label', () => {
    const html = renderToString(spinnerEl({ label: 'Working' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Working"');
    expect(renderToString(spinnerEl())).toContain('aria-label="Loading"');
  });
});

describe('tableEl', () => {
  it('renders headers and rows with alignment', () => {
    const html = renderToString(
      tableEl({
        id: 't',
        caption: 'Items',
        columns: [{ key: 'name', label: 'Name' }, { key: 'n', label: 'N', align: 'right' }],
        rows: [{ name: 'a', n: '1' }],
      }),
    );
    expect(html).toContain('role="table"');
    expect(html).toContain('aria-label="Items"');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('>a</td>');
    expect(html).toContain('align="right"');
  });

  it('renders an empty state row', () => {
    const html = renderToString(tableEl({ id: 't', columns: [{ key: 'name', label: 'Name' }], rows: [] }));
    expect(html).toContain('table__empty');
    expect(html).toContain('No rows to display.');
  });

  it('marks a sortable table and fills missing cells', () => {
    const html = renderToString(
      tableEl({
        id: 't',
        sortable: true,
        columns: [{ key: 'name', label: 'Name' }, { key: 'n', label: 'N' }],
        rows: [{ name: 'a' }],
      }),
    );
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('<td></td>');
  });
});

describe('modalEl', () => {
  it('renders a dialog with title and close button', () => {
    const html = renderToString(modalEl({ id: 'm', title: 'Delete', body: ['sure?'], closeAction: 'close:m' }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="m-title"');
    expect(html).toContain('data-action="close:m"');
  });

  it('is hidden when closed and renders a footer', () => {
    const html = renderToString(modalEl({ id: 'm', title: 'T', body: ['b'], footer: ['f'], open: false }));
    expect(html).toContain('hidden');
    expect(html).toContain('modal__footer');
  });
});

describe('toastEl', () => {
  it('renders a dismissible toast', () => {
    const toast: Toast = { id: '1', message: 'Saved', kind: 'success' };
    const html = renderToString(toastEl(toast));
    expect(html).toContain('toast--success');
    expect(html).toContain('data-action="dismiss:1"');
    expect(html).toContain('>Saved</p>');
  });
});

describe('formEl', () => {
  it('renders title, fields, error and actions', () => {
    const html = renderToString(
      formEl({
        id: 'f',
        title: 'Login',
        description: 'Enter your details',
        fields: [h('div', { id: 'field-a' })],
        submitLabel: 'Go',
        submitAction: 'submit:login',
        cancelLabel: 'Cancel',
        cancelAction: 'cancel:login',
        errorText: 'Nope',
      }),
    );
    expect(html).toContain('id="f"');
    expect(html).toContain('novalidate');
    expect(html).toContain('id="f-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-action="submit:login"');
    expect(html).toContain('data-action="cancel:login"');
  });

  it('omits optional sections', () => {
    const html = renderToString(formEl({ id: 'f', fields: [], submitLabel: 'Go' }));
    expect(html).not.toContain('form__error');
    expect(html).not.toContain('form__description');
  });
});
