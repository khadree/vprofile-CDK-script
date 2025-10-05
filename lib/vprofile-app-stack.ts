import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cp_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { cp } from 'node:fs/promises';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class VprofileAppStack extends cdk.Stack {
  common: Record<string, any> = [];
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    //S3 bucket for CodePipeline Artifact
    const artifactBucket = new s3.Bucket(this, 'Bucket',{
      bucketName: 'vprofile-artifact-bucket-my-2025',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ECR repository for application
    const ecrRepo = new ecr.Repository(this, 'Vprofile-ImageRepo', { repositoryName: "vporifle-repo", 
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    //VPC
    const vpc = this.common.vpc = ec2.Vpc.fromLookup(this, 'default', {vpcId: 'vpc-016cda76a4017103f'});

    //Security Group
    const vporifleSG = new ec2.SecurityGroup(this, 'Vprofile-SG',{
      securityGroupName:'Vprofile-Security',
      vpc,
      allowAllOutbound: true,
      description: "Allow traffic in and out of the specified container"
    });

    //Create the target group to be attached to the load balancer
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'VprofileTG',{
      targetGroupName: 'Vprofile-TargetGroup',
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/',
        timeout: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(60),
        healthyHttpCodes: '200'
      }
    });

    //Create the Laod balancer to be attached to the load balancer
    const lb = new elbv2.ApplicationLoadBalancer(this, 'loadbalabcer', {
      loadBalancerName: 'VprofileLB',
      vpc,
      internetFacing: true,
    });

    //Importing a listerner attached to the existing load balance
    // const existingLister = elbv2.ApplicationListener.fromLookup(this, 'lister',{
    //   loadBalancerArn: 'arn:aws:elasticloadbalancing:eu-west-1:114725187682:loadbalancer/app/VprofileLB/86abd76b04f0ef9d',
    //   listenerProtocol: elbv2.ApplicationProtocol.HTTPS,
    //   listenerPort: 443
    // });

    // existingLister.addTargetGroups('Vprofile-Listener',{
    //   targetGroups: [targetGroup],
    //   priority: 5,
    //   conditions: [
    //     elbv2.ListenerCondition.hostHeaders([''])
    //   ]
    // });
    

      // Add listener to the Load Balancer
    const listener = lb.addListener('Listener', {
      port: 80,
      open: true,
      defaultTargetGroups: [targetGroup],
    });

    //Create a Task definition needed to run the container
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Vprofile-TaskDefinition',{
      cpu: 2048,
      memoryLimitMiB: 4096

    });
   
    // Create a cluster
    const cluster = new ecs.Cluster(this, 'vprofile-cluster', {
      clusterName: 'Vprofile_Cluster',
      vpc
    });

    // Create a running container from the task definition
    const vprofileContainer = taskDefinition.addContainer('vprofilecontainer',{
      containerName: 'vprofileContainer',
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo),
      cpu: 2048,
      memoryLimitMiB: 4096,
      logging: ecs.LogDriver.awsLogs({ streamPrefix:'vprofile-log'}),
      portMappings: [{containerPort:8080, hostPort: 8080}]
    });

    //Create a service for the container
    const service = new ecs.FargateService(this, 'Vprofile-Service', {
      cluster,
      serviceName: 'vprofile_service',
      taskDefinition,
      securityGroups: [vporifleSG],
      desiredCount: 0,
      minHealthyPercent: 50,
      vpcSubnets: {
        subnets: [
          ec2.Subnet.fromSubnetId(this, 'vprofile-subnet1', "subnet-0b38a5082b9b32e58"),
          ec2.Subnet.fromSubnetId(this, 'vprofile-subnet2', "subnet-0f4ad8cc6c4d1b1a9"),
      ]},
      assignPublicIp: true
    });

    targetGroup.addTarget(service);

    //Create CodeBuild project that will be part of the pipeline
    const codeBuildProject = new codebuild.PipelineProject(this, 'vpofile-CodeBuild', {
      projectName: 'Vprofile-Project',
      environment:{
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          'IMAGE_REPO_NAME':{
            value: ecrRepo.repositoryName
          },
          'IMAGE_TAG': {
            value: "latest"
          },
          'CONTAINER_NAME': {
            value: vprofileContainer.containerName
          },
          'AWS_ACCOUNT_ID':{
            value: '114725187682'
          }
        },
      },
      buildSpec: codebuild.BuildSpec.fromAsset('lib/buildspec.yml')
    });

    codeBuildProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:*'],
      resources: ['*']
    }));

    const sourceArtifact = new codepipeline.Artifact();
    const buildArtifact = new codepipeline.Artifact();

// Create a Codeipipeline with Source, Build and Deploy Stage 
    new codepipeline.Pipeline(this, 'VprofilePipeline',{
      pipelineName: 'Vprofile-Pipeline',
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new cp_actions.CodeStarConnectionsSourceAction({
              actionName: 'Git_Repo_Source',
              owner: 'khadree',
              repo: 'vprofile-project',
              branch: 'docker',
              output: sourceArtifact,
              connectionArn: 'arn:aws:codeconnections:eu-west-1:114725187682:connection/279d25fe-aaff-4c22-a7c9-7f4c786df284'
            })
          ]
        },
        {
          stageName:'Build',
          actions: [
            new cp_actions.CodeBuildAction({
              actionName: 'CodeBuild',
              project: codeBuildProject,
              input: sourceArtifact,
              outputs: [buildArtifact]
            })
          ]
        },
        {
          stageName: 'Deploy',
          actions:[
            new cp_actions.EcsDeployAction({
              actionName: 'DeployAction',
              service,
              input: buildArtifact,
              deploymentTimeout: cdk.Duration.minutes(60)
            })
          ]
        }
      ]
    });
  }
}
