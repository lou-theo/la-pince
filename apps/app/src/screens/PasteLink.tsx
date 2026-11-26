import { type ReactNode, type SubmitEvent, useId, useState } from 'react';
import { useLocation } from 'wouter';

import { m } from '../i18n/paraglide/messages.js';
import { tokenFromLink } from '../model/link.ts';
import { InstallGuideLink } from './InstallOffer.tsx';
import layout from './Layout.module.css';
import { Layout } from './Layout.tsx';
import styles from './PasteLink.module.css';

/** Opens a group from its link pasted by hand: the way back for an installed app started without its link. */
export function PasteLink(): ReactNode {
  const [, navigate] = useLocation();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const errorId = useId();

  const open = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = tokenFromLink(text);
    if (token === undefined) {
      setInvalid(true);
      return;
    }
    navigate(`/g/${token}`);
  };

  return (
    <Layout>
      <h1 className={layout.title}>{m.home_title()}</h1>
      <p className={layout.muted}>{m.home_explanation()}</p>
      <form className={styles.form} onSubmit={open} noValidate>
        <label htmlFor={inputId}>{m.home_link_label()}</label>
        <input
          id={inputId}
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={m.home_link_placeholder()}
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <p id={errorId} className={layout.error} role="alert">
            {m.home_link_invalid()}
          </p>
        )}
        <button className={layout.button} type="submit">
          {m.home_open()}
        </button>
      </form>
      {/* Without a group, no profile: the guide starts again from here. */}
      <InstallGuideLink title={m.app_name()}>{m.install_entry()}</InstallGuideLink>
    </Layout>
  );
}
