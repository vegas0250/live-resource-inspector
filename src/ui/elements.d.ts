import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type VuiProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  variant?: string;
  size?: string;
  disabled?: boolean;
  label?: string;
  value?: string;
  placeholder?: string;
  open?: boolean;
  checked?: boolean;
  name?: string;
  type?: string;
  rows?: number;
  wrap?: boolean;
  banner?: boolean;
  form?: string;
  onClose?: () => void;
};

declare module 'react' {
  // React 19 читает элементы из этого интерфейса.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'vui-alert': VuiProps;
      'vui-button': VuiProps;
      'vui-dialog': VuiProps;
      'vui-input': VuiProps;
      'vui-option': VuiProps;
      'vui-radio': VuiProps;
      'vui-select': VuiProps;
      'vui-textarea': VuiProps;
      'vui-toolbar': VuiProps;
    }
  }
}
