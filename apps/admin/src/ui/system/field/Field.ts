import styles from './Field.module.scss';

// identity-experience's field styles (packages/ui/src/system/field), as classes. Its TextField,
// TextAreaField and SelectField own their ids and their error; this application's forms already own
// theirs, with the ids, hints and errors their tests read, so they take the classes instead.
const join = (...names: readonly (string | undefined)[]): string => names.filter(Boolean).join(' ');

export const fieldClasses = {
  field: styles['field'],
  label: styles['label'],
  hint: styles['hint'],
  error: styles['error'],
  input: styles['control'],
  area: join(styles['control'], styles['area']),
  select: join(styles['control'], styles['select']),
  fieldset: styles['fieldset'],
  legend: styles['legend'],
  choice: styles['choice'],
  choiceInput: styles['choiceInput'],
} as const;
