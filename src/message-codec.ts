import type { PromptLayout, PromptMessage, ProviderToolIO } from "./types";

/**
 * Bidirectional codec between PromptLayout (IR) and provider-native input.
 */
export abstract class MessageCodec<TRendered, TToolIO extends ProviderToolIO> {
  abstract render(layout: PromptLayout<TToolIO>): TRendered;
  abstract parse(rendered: TRendered): PromptLayout<TToolIO>;
}

/**
 * List-based codec that maps message-by-message between IR and provider input.
 * Providers with non-standard structures can override render/parse directly.
 */
export abstract class ListMessageCodec<
  TProviderMessage,
  TToolIO extends ProviderToolIO,
> extends MessageCodec<readonly TProviderMessage[], TToolIO> {
  protected abstract toProviderMessage(
    message: PromptMessage<TToolIO>
  ): readonly TProviderMessage[];
  protected abstract fromProviderMessage(
    message: TProviderMessage
  ): readonly PromptMessage<TToolIO>[];

  override render(layout: PromptLayout<TToolIO>): readonly TProviderMessage[] {
    return layout.flatMap((message) => this.toProviderMessage(message));
  }

  override parse(rendered: readonly TProviderMessage[]): PromptLayout<TToolIO> {
    return rendered.flatMap((message) => this.fromProviderMessage(message));
  }
}
