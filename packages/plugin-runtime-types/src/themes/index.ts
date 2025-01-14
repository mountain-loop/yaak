export type Colors = {
  surface: string;
  surfaceHighlight?: string;
  surfaceActive?: string;

  text: string;
  textSubtle?: string;
  textSubtlest?: string;

  border?: string;
  borderSubtle?: string;
  borderFocus?: string;

  shadow?: string;
  backdrop?: string;
  selection?: string;

  primary?: string;
  secondary?: string;
  info?: string;
  success?: string;
  notice?: string;
  warning?: string;
  danger?: string;
};

export type Theme = Colors & {
  id: string;
  name: string;
  components?: Partial<{
    dialog: Partial<Colors>;
    menu: Partial<Colors>;
    toast: Partial<Colors>;
    sidebar: Partial<Colors>;
    responsePane: Partial<Colors>;
    appHeader: Partial<Colors>;
    button: Partial<Colors>;
    banner: Partial<Colors>;
    placeholder: Partial<Colors>;
    urlBar: Partial<Colors>;
    editor: Partial<Colors>;
    input: Partial<Colors>;
  }>;
};
