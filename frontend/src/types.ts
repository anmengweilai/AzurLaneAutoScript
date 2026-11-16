export type Bootstrap = {
  authenticated: boolean;
  settings: {
    language: string;
    theme: 'default' | 'dark';
    languages: string[];
    password_required: boolean;
  };
};

export type Instance = {
  name: string;
  mod: string;
  state: string;
  pid?: number | null;
  started_at?: string | null;
  log_cursor: number;
};
