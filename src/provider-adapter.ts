import { MessageCodec } from "./message-codec";
import type { PromptLayout, ProviderToolIO } from "./types";
import { ModelProvider } from "./types";

/**
 * Structural mapping between protocol input and provider input.
 *
 * Adapters must not change semantics (no merging/splitting). They only
 * reshape fields and content containers.
 */
export interface ProviderAdapter<TProtocolInput, TProviderInput> {
  /** Convert protocol input into the provider-native input shape. */
  toProvider(input: TProtocolInput): TProviderInput;
  /** Convert provider-native input into the protocol input shape. */
  fromProvider(input: TProviderInput): TProtocolInput;
}

/**
 * Compose a protocol codec with a provider adapter into a provider codec.
 */
export class CompositeCodec<
  TProviderInput,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> extends MessageCodec<TProviderInput, TToolIO> {
  private readonly protocol: MessageCodec<TProtocolInput, TToolIO>;
  private readonly adapter: ProviderAdapter<TProtocolInput, TProviderInput>;

  constructor(
    protocol: MessageCodec<TProtocolInput, TToolIO>,
    adapter: ProviderAdapter<TProtocolInput, TProviderInput>
  ) {
    super();
    this.protocol = protocol;
    this.adapter = adapter;
  }

  /** Render PromptLayout into provider input via protocol + adapter. */
  render(layout: PromptLayout<TToolIO>): TProviderInput {
    return this.adapter.toProvider(this.protocol.render(layout));
  }

  /** Parse provider input into PromptLayout via adapter + protocol. */
  parse(input: TProviderInput): PromptLayout<TToolIO> {
    return this.protocol.parse(this.adapter.fromProvider(input));
  }
}

/**
 * Base provider that binds protocol + adapter into a single codec.
 */
export abstract class ProtocolProvider<
  TProviderInput,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> extends ModelProvider<TProviderInput, TToolIO> {
  readonly codec: MessageCodec<TProviderInput, TToolIO>;

  /** Construct a protocol provider with a protocol codec and adapter. */
  protected constructor(
    protocol: MessageCodec<TProtocolInput, TToolIO>,
    adapter: ProviderAdapter<TProtocolInput, TProviderInput>
  ) {
    super();
    this.codec = new CompositeCodec(protocol, adapter);
  }
}
