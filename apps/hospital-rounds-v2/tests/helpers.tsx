/*
 * UI テスト用ヘルパ: seed 付きで App を起動する。
 *  - runtime を外から作って initStore({ bundle }) で患者を注入 (storage 経由不要)。
 *  - settings は initStore が defaultSettings を seed する (defaults.json の既定フォーマット)。
 */
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { App } from '../src/App';
import { createAppRuntime, type AppRuntime } from '../src/ui/appRuntime';
import { SECTION, projectBundle, type Bundle } from '../src/data/bundle';
import { defaultSettings, normalizePatientArray } from '../src/domain/normalize';
import type { AppState, Patient } from '../src/domain/types';

/** 先頭スロットから patch を流し込んだ 50 患者の bundle を作る。 */
export function seedBundle(patches: Array<Partial<Patient>>): Bundle {
  const patients = normalizePatientArray(null);
  patches.forEach((patch, i) => {
    Object.assign(patients[i] as Patient, patch);
  });
  const appState: AppState = { v: 3, title: '回診', patients, recvMemo: '', recvShared: '' };
  return projectBundle({
    appState,
    settings: defaultSettings(),
    sections: [SECTION.META, SECTION.PATIENTS],
  });
}

export interface RenderedApp {
  runtime: AppRuntime;
  container: HTMLElement;
  unmount: () => void;
}

/** App を起動して home が描画されるまで待つ。 */
export async function renderApp(opts: { bundle?: Bundle } = {}): Promise<RenderedApp> {
  const runtime = createAppRuntime();
  await runtime.store.initStore(opts.bundle ? { bundle: opts.bundle } : undefined);
  const utils = render((<App runtime={runtime} />) as ReactElement);
  // 起動画面 → home (診察開始ボタンが出たら ready)
  await screen.findByText('診察開始');
  return { runtime, container: utils.container, unmount: utils.unmount };
}
