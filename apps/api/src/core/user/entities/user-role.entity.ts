import { Entity, Column, PrimaryColumn } from 'typeorm';

import { UserRoleId } from '@libs/dto';

@Entity()
export class UserRole {
  constructor(id: UserRoleId, name: string) {
    this.id = id;
    this.name = name;
  }

  @PrimaryColumn({ type: 'integer' })
  id: UserRoleId;

  @Column({ type: 'text' })
  name: string;
}
