#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VprofileAppStack } from '../lib/vprofile-app-stack';

const app = new cdk.App();
new VprofileAppStack(app, 'VprofileAppStack', {
  env: { account: "114725187682", region:"eu-west-1" },
  description: "Deploys the services resoures for Vprofile service"
});