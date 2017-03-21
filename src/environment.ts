import {
  Arguments,
  DOMChanges,
  DOMTreeConstruction,
  Environment as GlimmerEnvironment,
  Helper as GlimmerHelper,
  ModifierManager,
  templateFactory,
  ComponentDefinition,
  Component,
  ComponentManager
} from '@glimmer/runtime';
import {
  VersionedPathReference,
  Reference,
  OpaqueIterable,
  combineTagged,
  map,
  isConst
} from "@glimmer/reference";
import {
  dict,
  Opaque
} from '@glimmer/util';
import {
  getOwner,
  setOwner,
  Owner,
  Factory
} from '@glimmer/di';
import Iterable from './iterable';
import TemplateMeta from './template-meta';
import ComponentDefinitionCreator from './component-definition-creator'
import Application from "./application";

type KeyFor<T> = (item: Opaque, index: T) => string;

export interface EnvironmentOptions {
  document?: HTMLDocument;
  appendOperations?: DOMTreeConstruction;
}

class DefaultComponentDefinition extends ComponentDefinition<any> {
  toJSON() {
    return `<default-component-definition name=${this.name}>`;
  }
}

const DEFAULT_MANAGER = 'main';

export default class Environment extends GlimmerEnvironment {
  private helpers = dict<GlimmerHelper>();
  private modifiers = dict<ModifierManager<Opaque>>();
  private components = dict<ComponentDefinition<Component>>();
  private managers = dict<ComponentManager<Component>>();
  private uselessAnchor: HTMLAnchorElement;

  static create(options: EnvironmentOptions = {}) {
    options.document = options.document || self.document;
    options.appendOperations = options.appendOperations || new DOMTreeConstruction(options.document);

    return new Environment(options);
  }

  constructor(options: EnvironmentOptions) {
    super({ appendOperations: options.appendOperations, updateOperations: new DOMChanges(options.document as HTMLDocument || document) });

    setOwner(this, getOwner(options));

    // TODO - required for `protocolForURL` - seek alternative approach
    // e.g. see `installPlatformSpecificProtocolForURL` in Ember
    this.uselessAnchor = options.document.createElement('a') as HTMLAnchorElement;

    this.helpers['if'] = function(_, args: Arguments): VersionedPathReference<Opaque> {
      let cond = args.at<VersionedPathReference<Opaque>>(0);
      let truthy = args.at<VersionedPathReference<Opaque>>(1);
      let falsy = args.at<VersionedPathReference<Opaque>>(2);

      if (isConst(cond)) {
        return cond.value() ? truthy : falsy;
      } else {
        let mapped = map(cond, val => val ? truthy.value() : falsy.value()) as any as VersionedPathReference<Opaque>;
        mapped.tag = combineTagged([cond, truthy, falsy]);
        return mapped;
      }
    }
  }

  protocolForURL(url: string): string {
    // TODO - investigate alternative approaches
    // e.g. see `installPlatformSpecificProtocolForURL` in Ember
    this.uselessAnchor.href = url;
    return this.uselessAnchor.protocol;
  }

  hasPartial() {
    return false;
  }

  lookupPartial(): any {
  }

  managerFor(managerId: string = DEFAULT_MANAGER): ComponentManager<Component> {
    let manager: ComponentManager<Component>;

    manager = this.managers[managerId];
    if (!manager) {
      let app: Application = getOwner(this) as any as Application;
      manager = this.managers[managerId] = getOwner(this).lookup(`component-manager:/${app.rootName}/component-managers/${managerId}`);
      if (!manager) {
        throw new Error(`No component manager found for ID ${managerId}.`);
      }
    }
    return manager;
  }

  hasComponentDefinition(name: string, meta: TemplateMeta): boolean {
    return !!this.getComponentDefinition(name, meta);
  }

  getComponentDefinition(name: string, meta: TemplateMeta): ComponentDefinition<Component> {
    let owner: Owner = getOwner(this);
    let relSpecifier: string = `template:${name}`;
    let referrer: string = meta.specifier;

    let specifier = owner.identify(relSpecifier, referrer);

    if (!this.components[specifier]) {
      return this.registerComponent(name, specifier, meta, owner);
    }

    return this.components[specifier];
  }

  registerComponent(name: string, templateSpecifier: string, meta: TemplateMeta, owner: Owner): ComponentDefinition<Component> {
    let serializedTemplate = owner.lookup('template', templateSpecifier);
    if (!serializedTemplate) {
      throw new Error("Could not find template for " + templateSpecifier);
    }

    let componentSpecifier = owner.identify('component', templateSpecifier);
    let componentFactory: Factory<Component> = null;

    if (componentSpecifier) {
      componentFactory = owner.factoryFor(componentSpecifier);
    }

    let template = templateFactory<TemplateMeta>(serializedTemplate).create(this);
    let manager: ComponentManager<Component> = this.managerFor(meta.managerId);
    let definition: ComponentDefinition<Component>;

    if (canCreateComponentDefinition(manager)) {
      definition = manager.createComponentDefinition(name, template, componentFactory);
    } else {
      definition = new DefaultComponentDefinition(name, manager, componentFactory);
    }

    this.components[name] = definition;

    return definition;
  }

  hasHelper(name: string, blockMeta: TemplateMeta) {
    return (name in this.helpers);
  }

  lookupHelper(name: string, blockMeta: TemplateMeta) {
    let helper = this.helpers[name];

    if (!helper) throw new Error(`Helper for ${name} not found.`);

    return helper;
  }

  hasModifier(name: string, blockMeta: TemplateMeta): boolean {
    return (name in this.modifiers);
  }

  lookupModifier(name: string, blockMeta: TemplateMeta): ModifierManager<Opaque> {
    let modifier = this.modifiers[name];

    if(!modifier) throw new Error(`Modifier for ${name} not found.`);

    return modifier;
  }

  iterableFor(ref: Reference<Opaque>, keyPath: string): OpaqueIterable {
    let keyFor: KeyFor<Opaque>;

    if (!keyPath) {
      throw new Error('Must specify a key for #each');
    }

    switch (keyPath) {
      case '@index':
        keyFor = (_, index: number) => String(index);
      break;
      case '@primitive':
        keyFor = (item: Opaque) => String(item);
      break;
      default:
        keyFor = (item: Opaque) => item[keyPath];
      break;
    }

    return new Iterable(ref, keyFor);
  }
}

function canCreateComponentDefinition(manager: ComponentDefinitionCreator | ComponentManager<Component>): manager is ComponentDefinitionCreator {
  return (manager as ComponentDefinitionCreator).createComponentDefinition !== undefined;
}
