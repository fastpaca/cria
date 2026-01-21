import { MessageCodec } from "./message-codec";
import type { PromptLayout, ProviderToolIO } from "./types";
import { ModelProvider } from "./types";

export interface ProviderAdapter<TProtocolInput, TProviderInput> {
  toProvider(input: TProtocolInput): TProviderInput;
  fromProvider(input: TProviderInput): TProtocolInput;
}

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

  render(layout: PromptLayout<TToolIO>): TProviderInput {
    return this.adapter.toProvider(this.protocol.render(layout));
  }

  parse(input: TProviderInput): PromptLayout<TToolIO> {
    return this.protocol.parse(this.adapter.fromProvider(input));
  }
}

export abstract class ProtocolProvider<
  TProviderInput,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> extends ModelProvider<TProviderInput, TToolIO> {
  readonly codec: MessageCodec<TProviderInput, TToolIO>;

  protected constructor(
    protocol: MessageCodec<TProtocolInput, TToolIO>,
    adapter: ProviderAdapter<TProtocolInput, TProviderInput>
  ) {
    super();
    this.codec = new CompositeCodec(protocol, adapter);
  }
}
